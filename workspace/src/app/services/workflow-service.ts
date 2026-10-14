/**
 * Workflow orchestrator — the only component allowed to drive the run state
 * machine (SRS-STATE-003) and to decide when a settlement is attempted.
 *
 * Attempt-level recovery policy (documented in docs/ARCHITECTURE.md):
 *  * A *retryable* agent failure is recovered through the transactional outbox with
 *    an explicit attempt increment. Nothing depends on queue redelivery semantics,
 *    and each attempt is a first-class, auditable record.
 *  * BullMQ's own bounded attempts/backoff cover pure infrastructure failures,
 *    which is the only case where the job handler throws with no recorded state
 *    change.
 *  * A *non-retryable* failure (authorization, policy, malformed model output)
 *    terminates the run. Retrying those would be unsafe or pointless (SRS-QUEUE-004).
 *
 * Pausing for approval is not a failure: the run's state is persisted and the
 * worker releases its slot (SRS-STATE-005, PR-09).
 */
import { deriveAttemptId, deriveOperationId } from '../../domain/ids.js';
import { AppError, ErrorCode, conflict } from '../../domain/errors.js';
import { assertRunTransition, isTerminalRunStatus } from '../../domain/state.js';
import { emitEvent, recordAudit, recordStep } from './telemetry.js';
import type { ResearchReport, RunJobPayload, RunRecord, Store } from '../ports.js';
import type { AgentRuntime } from '../agent/runtime.js';
import type { ExecutionOutcome } from '../agent/types.js';
import type { SettlementService } from './settlement-service.js';
import type { Clock, LoggerPort } from '../ports.js';

export interface WorkflowServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  runtime: AgentRuntime;
  settlement: SettlementService;
  maxAttempts: number;
  providerName: string;
}

export class WorkflowService {
  readonly #deps: WorkflowServiceDeps;

  constructor(deps: WorkflowServiceDeps) {
    this.#deps = deps;
  }

  /** Handles one queued run-execution job. Safe to call repeatedly. */
  async executeRun(job: RunJobPayload): Promise<{ outcome: string }> {
    const { store, logger, clock } = this.#deps;
    const run = await store.runs.findById(job.runId);
    if (!run) {
      logger.warn({ runId: job.runId, attemptId: job.attemptId }, 'run job for an unknown run ignored');
      return { outcome: 'RUN_NOT_FOUND' };
    }

    // SRS-STATE-006: a terminal run never resumes through duplicate delivery.
    if (isTerminalRunStatus(run.status)) {
      await recordStep(store, {
        runId: run.id,
        attemptId: job.attemptId,
        stepType: 'RECOVERY_REQUEUE',
        status: 'SKIPPED',
        summary: `Duplicate delivery ignored for ${run.status} run`,
      });
      await emitEvent(store, {
        runId: run.id,
        eventType: 'run.duplicate_delivery_ignored',
        payload: { runId: run.id, status: run.status, attemptId: job.attemptId, reason: job.reason },
      });
      return { outcome: 'TERMINAL_IGNORED' };
    }

    if (run.status === 'REQUIRES_HUMAN_APPROVAL') {
      if (job.reason === 'APPROVAL_RESUME') return this.#resumeAfterDecision(run, job);
      logger.info({ runId: run.id }, 'run awaiting human approval; job not applicable');
      return { outcome: 'AWAITING_APPROVAL' };
    }

    // One writer per attempt: a second delivery of the *same* attempt is a no-op,
    // and a different attempt may only start once the run is PENDING.
    if (run.status === 'RUNNING' && run.attemptId !== job.attemptId) {
      await recordStep(store, {
        runId: run.id,
        attemptId: job.attemptId,
        stepType: 'RECOVERY_REQUEUE',
        status: 'SKIPPED',
        summary: `Attempt ${run.attemptId} is already in flight; duplicate start ignored`,
      });
      return { outcome: 'ATTEMPT_IN_FLIGHT' };
    }

    const startedAt = clock.now();
    const claimed = await store.transaction(async (tx) => {
      const updated = await tx.runs.transition({
        id: run.id,
        expectedVersion: run.version,
        to: 'RUNNING',
        patch: {
          startedAt: run.startedAt ?? startedAt,
          attemptId: job.attemptId,
          attemptCount: job.attemptCount,
          heartbeatAt: startedAt,
        },
      });
      if (!updated) return null;
      await emitEvent(tx, {
        runId: run.id,
        eventType: 'run.started',
        payload: { runId: run.id, attemptId: job.attemptId, attemptCount: job.attemptCount, reason: job.reason },
      });
      return updated;
    });

    if (!claimed) {
      // Lost the compare-and-set: another worker owns the run now.
      logger.info({ runId: run.id }, 'concurrent run transition lost; this delivery is a no-op');
      await recordStep(store, {
        runId: run.id,
        attemptId: job.attemptId,
        stepType: 'RECOVERY_REQUEUE',
        status: 'SKIPPED',
        summary: 'Concurrent transition already applied by another worker',
      });
      return { outcome: 'CONCURRENT_TRANSITION' };
    }

    const outcome = await this.#deps.runtime.execute({ run: claimed, attemptId: job.attemptId });
    return this.#applyOutcome(claimed, job, outcome);
  }

  // -------------------------------------------------------------------------
  // Outcome handling
  // -------------------------------------------------------------------------

  async #applyOutcome(run: RunRecord, job: RunJobPayload, outcome: ExecutionOutcome): Promise<{ outcome: string }> {
    const { store, clock, logger } = this.#deps;

    if (outcome.kind === 'AWAITING_APPROVAL') {
      const report = this.#composeReport(run, outcome, null, null);
      await store.transaction(async (tx) => {
        await recordStep(tx, {
          runId: run.id,
          attemptId: job.attemptId,
          stepType: 'RESEARCH_REPORT',
          status: 'SUCCEEDED',
          summary: 'Draft report stored while awaiting human approval',
          payload: { report: report as unknown as Record<string, unknown>, draft: true },
        });
        const updated = await tx.runs.transition({
          id: run.id,
          expectedVersion: run.version,
          to: 'REQUIRES_HUMAN_APPROVAL',
          patch: { heartbeatAt: clock.now(), tokenUsage: outcome.tokenUsage },
        });
        if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while pausing for approval.');
        await emitEvent(tx, {
          runId: run.id,
          eventType: 'run.awaiting_approval',
          payload: {
            runId: run.id,
            proposalId: outcome.pendingProposalId,
            approvalId: outcome.approvalId,
            amountMinor: outcome.proposals.find((p) => p.requiresApproval)?.amountMinor ?? 0,
            currency: outcome.proposals.find((p) => p.requiresApproval)?.currency ?? 'USD',
          },
        });
        await recordAudit(tx, {
          tenantId: run.tenantId,
          runId: run.id,
          actorType: 'SYSTEM',
          action: 'run.awaiting_approval',
          targetType: 'run',
          targetId: run.id,
          metadata: { proposalId: outcome.pendingProposalId, approvalId: outcome.approvalId },
        });
      });
      logger.info({ runId: run.id, proposalId: outcome.pendingProposalId }, 'run paused for human approval; worker released');
      return { outcome: 'AWAITING_APPROVAL' };
    }

    if (outcome.kind === 'FAILED') {
      const attemptsExhausted = job.attemptCount >= this.#deps.maxAttempts;
      if (outcome.retryable && !attemptsExhausted) {
        // Re-queue through the outbox with an explicit next attempt id.
        const nextAttemptCount = job.attemptCount + 1;
        const nextAttemptId = deriveAttemptId(run.id, nextAttemptCount);
        await store.transaction(async (tx) => {
          const updated = await tx.runs.transition({
            id: run.id,
            expectedVersion: run.version,
            to: 'PENDING',
            patch: { attemptId: null, errorCode: outcome.code, errorMessage: outcome.message, tokenUsage: outcome.tokenUsage },
          });
          if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while scheduling a retry.');
          await recordStep(tx, {
            runId: run.id,
            attemptId: job.attemptId,
            stepType: 'RECOVERY_REQUEUE',
            status: 'SUCCEEDED',
            summary: `Retryable failure ${outcome.code}; scheduling attempt ${nextAttemptCount}`,
            payload: { code: outcome.code, nextAttemptCount, nextAttemptId },
          });
          await tx.outbox.enqueue({
            topic: 'run.execute',
            dedupeKey: `execute:run:${run.id}:attempt:${nextAttemptId}`,
            payload: { version: 1, runId: run.id, attemptId: nextAttemptId, attemptCount: nextAttemptCount, reason: 'RECOVERY' },
          });
          await emitEvent(tx, {
            runId: run.id,
            eventType: 'run.retry_scheduled',
            payload: { runId: run.id, code: outcome.code, nextAttemptCount, delaySeconds: 0 },
          });
        });
        logger.warn({ runId: run.id, code: outcome.code, nextAttemptCount }, 'retryable failure; attempt re-queued');
        return { outcome: 'RETRY_SCHEDULED' };
      }

      await store.transaction(async (tx) => {
        const updated = await tx.runs.transition({
          id: run.id,
          expectedVersion: run.version,
          to: 'FAILED',
          patch: {
            completedAt: clock.now(),
            errorCode: outcome.code,
            errorMessage: outcome.message,
            tokenUsage: outcome.tokenUsage,
          },
        });
        if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while recording failure.');
        await emitEvent(tx, {
          runId: run.id,
          eventType: 'run.failed',
          payload: { runId: run.id, code: outcome.code, message: outcome.message, retryable: outcome.retryable, attempts: job.attemptCount },
        });
        await recordAudit(tx, {
          tenantId: run.tenantId,
          runId: run.id,
          actorType: 'SYSTEM',
          action: 'run.failed',
          targetType: 'run',
          targetId: run.id,
          metadata: { code: outcome.code, attempts: job.attemptCount, retryable: outcome.retryable },
        });
      });
      return { outcome: 'FAILED' };
    }

    // COMPLETED: settle any policy-auto-allowed proposal, then close the run.
    const settlements: NonNullable<ResearchReport['settlement']>[] = [];
    for (const proposal of outcome.proposals) {
      if (proposal.proposalId === null || proposal.status !== 'APPROVED' || proposal.requiresApproval) continue;
      const settled = await this.#deps.settlement.settle({
        proposalId: proposal.proposalId,
        operationId: deriveOperationId({
          proposalId: proposal.proposalId,
          revision: 1,
          supplierId: proposal.supplierId,
          amountMinor: proposal.amountMinor,
          currency: proposal.currency,
        }),
        attemptId: job.attemptId,
      });
      if (settled.status === 'SETTLED' || settled.status === 'ALREADY_SETTLED') {
        settlements.push({
          operationId: settled.operationId,
          status: 'COMMITTED',
          ledgerEntryId: settled.ledgerEntryId,
          amountMinor: settled.amountMinor,
          currency: settled.currency,
        });
      }
    }

    const report = this.#composeReport(run, outcome, null, settlements[0] ?? null);

    await store.transaction(async (tx) => {
      await recordStep(tx, {
        runId: run.id,
        attemptId: job.attemptId,
        stepType: 'RESEARCH_REPORT',
        status: 'SUCCEEDED',
        summary: `Report finalised with ${report.findings.length} finding(s)`,
        payload: { report: report as unknown as Record<string, unknown>, draft: false },
      });
      const updated = await tx.runs.transition({
        id: run.id,
        expectedVersion: run.version,
        to: 'COMPLETED',
        patch: {
          completedAt: clock.now(),
          heartbeatAt: clock.now(),
          tokenUsage: outcome.tokenUsage,
          result: { report, generatedAt: clock.now().toISOString() },
          errorCode: null,
          errorMessage: null,
        },
      });
      if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while completing.');
      await emitEvent(tx, {
        runId: run.id,
        eventType: 'run.completed',
        payload: {
          runId: run.id,
          findingCount: report.findings.length,
          proposalCount: report.proposalIds.length,
          settlementCount: settlements.length,
        },
      });
      await recordAudit(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorType: 'SYSTEM',
        action: 'run.completed',
        targetType: 'run',
        targetId: run.id,
        metadata: { findingCount: report.findings.length, proposals: report.proposalIds, settlements },
      });
    });

    logger.info({ runId: run.id, findings: report.findings.length }, 'run completed');
    return { outcome: 'COMPLETED' };
  }

  // -------------------------------------------------------------------------
  // Approval resumption
  // -------------------------------------------------------------------------

  /**
   * Resumes a paused run after a decision. The model is not re-invoked: the
   * durable decision is applied, the settlement (if the decision authorized one)
   * is attempted idempotently, and the run closes with the draft report plus the
   * explicit outcome.
   */
  async #resumeAfterDecision(run: RunRecord, job: RunJobPayload): Promise<{ outcome: string }> {
    const { store, clock, logger } = this.#deps;

    const proposals = await store.proposals.listByRun(run.id);
    if (proposals.length === 0) {
      // Nothing to resume; close the run honestly rather than leaving it stuck.
      await store.transaction(async (tx) => {
        const updated = await tx.runs.transition({
          id: run.id,
          expectedVersion: run.version,
          to: 'COMPLETED',
          patch: { completedAt: clock.now() },
        });
        if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while resuming.');
        await emitEvent(tx, { runId: run.id, eventType: 'run.completed', payload: { runId: run.id, note: 'resume with no proposals' } });
      });
      return { outcome: 'COMPLETED_WITHOUT_PROPOSALS' };
    }

    const draft = await this.#latestReportStep(run.id);
    if (!draft) throw new AppError({ code: ErrorCode.INTERNAL_ERROR, message: 'Paused run has no stored report to resume from.', category: 'INTERNAL', httpStatus: 500, retryable: false });

    const nextAttemptCount = run.attemptCount + 1;
    const attemptId = deriveAttemptId(run.id, nextAttemptCount);
    const resumed = await store.transaction(async (tx) => {
      assertRunTransition(run.status, 'RUNNING');
      const updated = await tx.runs.transition({
        id: run.id,
        expectedVersion: run.version,
        to: 'RUNNING',
        patch: { attemptId, attemptCount: nextAttemptCount, heartbeatAt: clock.now() },
      });
      if (!updated) return null;
      await emitEvent(tx, {
        runId: run.id,
        eventType: 'run.resumed',
        payload: { runId: run.id, attemptId, attemptCount: nextAttemptCount, reason: job.reason },
      });
      return updated;
    });

    if (!resumed) {
      logger.info({ runId: run.id }, 'resume lost the compare-and-set; another worker already resumed this run');
      return { outcome: 'CONCURRENT_RESUME' };
    }

    let approvalOutcome: ResearchReport['approval'] | undefined;
    let settlement: ResearchReport['settlement'] | null = null;

    for (const proposal of proposals) {
      const approval = await store.approvals.findByProposalId(proposal.id);
      if (!approval) continue;
      approvalOutcome = {
        approvalId: approval.id,
        status: approval.status,
        proposalId: proposal.id,
        ...(approval.decisionReason ? { reason: approval.decisionReason } : {}),
      };

      if (approval.status !== 'APPROVED') {
        await recordStep(store, {
          runId: run.id,
          attemptId,
          stepType: 'SETTLEMENT',
          status: 'SKIPPED',
          summary: `No settlement attempted: approval is ${approval.status}`,
        });
        continue;
      }

      const operationId = deriveOperationId({
        proposalId: proposal.id,
        revision: proposal.revision,
        supplierId: proposal.supplierId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
      });
      const result = await this.#deps.settlement.settle({ proposalId: proposal.id, operationId, attemptId });
      if (result.status === 'SETTLED' || result.status === 'ALREADY_SETTLED') {
        settlement = {
          operationId: result.operationId,
          status: 'COMMITTED',
          ledgerEntryId: result.ledgerEntryId,
          amountMinor: result.amountMinor,
          currency: result.currency,
        };
      } else {
        settlement = { operationId: result.operationId, status: 'FAILED', ledgerEntryId: null, amountMinor: proposal.amountMinor, currency: proposal.currency };
        await emitEvent(store, {
          runId: run.id,
          eventType: 'settlement.refused',
          payload: { operationId: result.operationId, proposalId: proposal.id, code: result.code, reason: result.reason },
        });
      }
    }

    const report: ResearchReport = {
      ...draft,
      ...(approvalOutcome ? { approval: approvalOutcome } : {}),
      ...(settlement ? { settlement } : {}),
    };

    await store.transaction(async (tx) => {
      await recordStep(tx, {
        runId: run.id,
        attemptId,
        stepType: 'RESEARCH_REPORT',
        status: 'SUCCEEDED',
        summary: 'Final report after approval decision',
        payload: { report: report as unknown as Record<string, unknown>, draft: false },
      });
      const updated = await tx.runs.transition({
        id: run.id,
        expectedVersion: resumed.version,
        to: 'COMPLETED',
        patch: {
          completedAt: clock.now(),
          heartbeatAt: clock.now(),
          result: { report, generatedAt: clock.now().toISOString() },
        },
      });
      if (!updated) throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'Run changed while completing after approval.');
      await emitEvent(tx, {
        runId: run.id,
        eventType: 'run.completed',
        payload: { runId: run.id, settled: settlement !== null, approval: approvalOutcome?.status ?? null },
      });
      await recordAudit(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorType: 'SYSTEM',
        action: 'run.completed_after_decision',
        targetType: 'run',
        targetId: run.id,
        metadata: { approvalStatus: approvalOutcome?.status ?? null, settlement },
      });
    });

    logger.info({ runId: run.id, settled: settlement !== null }, 'run completed after approval decision');
    return { outcome: settlement ? 'SETTLED' : 'COMPLETED_NO_SETTLEMENT' };
  }

  // -------------------------------------------------------------------------
  // Report composition
  // -------------------------------------------------------------------------

  /**
   * Composes the durable report. Deterministic facts come from the rule engine;
   * the model only contributes the clearly-labelled interpretation.
   */
  #composeReport(
    run: RunRecord,
    outcome: Extract<ExecutionOutcome, { kind: 'COMPLETED' | 'AWAITING_APPROVAL' }>,
    approval: ResearchReport['approval'] | null,
    settlement: ResearchReport['settlement'] | null,
  ): ResearchReport {
    const limitations = [...outcome.report.limitations];
    if (outcome.proposals.some((proposal) => proposal.policyOutcome === 'DENY')) {
      limitations.push('At least one proposed refund was denied by the deterministic policy engine and was not settled.');
    }
    limitations.push('Settlement in this MVP is simulated: no real funds are transferred.');

    return {
      taskType: run.taskType,
      window: { from: run.request.from, to: run.request.to },
      transactionCount: outcome.analysis.transactionCount,
      totalSpendMinor: outcome.analysis.totalSpendMinor,
      currency: outcome.analysis.currency,
      ruleVersion: outcome.analysis.ruleVersion,
      findings: outcome.analysis.findings,
      interpretation: {
        model: outcome.model,
        provider: this.#deps.providerName,
        summary: outcome.report.summary,
        highlightedFindingIds: outcome.report.highlightedFindingIds,
      },
      limitations,
      proposalIds: outcome.proposals.map((proposal) => proposal.proposalId).filter((id): id is string => id !== null),
      ...(approval ? { approval } : {}),
      ...(settlement ? { settlement } : {}),
    };
  }

  async #latestReportStep(runId: string): Promise<ResearchReport | null> {
    const steps = await this.#deps.store.steps.listByRun(runId);
    for (const step of [...steps].reverse()) {
      if (step.stepType !== 'RESEARCH_REPORT' || step.status !== 'SUCCEEDED') continue;
      const payload = step.payload as { report?: ResearchReport } | null;
      if (payload?.report) return payload.report;
    }
    return null;
  }
}
