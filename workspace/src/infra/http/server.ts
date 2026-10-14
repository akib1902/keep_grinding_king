/**
 * HTTP surface — PR §7 API product surface, SRS §4.2.
 *
 * Structure:
 *  * one authentication hook that turns a verified token into a database-backed
 *    principal (never trusting a body-supplied user or tenant),
 *  * one place where permissions are asserted,
 *  * one error mapper, so every failure — validation, authorization, policy,
 *    concurrency, internal — returns the same documented shape.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode, forbidden, notFound, unauthorized } from '../../domain/errors.js';
import { CurrencySchema } from '../../domain/money.js';
import { assertPermission, extractBearerToken, isRole, mintToken, verifyToken, type AuthPrincipal, type Permission } from '../auth/jwt.js';
import { withContext } from '../logging/logger.js';
import { toErrorResponse } from './errors.js';
import { streamRunEvents } from './sse.js';
import type { CoreContainer, RunServices } from '../../container.js';
import type { LoggerPort, RunRecord } from '../../app/ports.js';

export interface ServerDeps {
  core: CoreContainer;
  services: RunServices;
  /** Injected for tests so the clock and ids used by auth tests are controllable. */
  devTokenEnabled?: boolean;
}

export interface ServerHandle {
  app: FastifyInstance;
  close(): Promise<void>;
}

const RunRequestSchema = z.object({
  task: z.string().trim().min(10, 'Describe the research task in at least 10 characters.').max(2000),
  taskType: z.enum(['SPEND_ANOMALY_RESEARCH', 'SUPPLIER_DISCREPANCY_REVIEW']).default('SPEND_ANOMALY_RESEARCH'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be an ISO date (YYYY-MM-DD).'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be an ISO date (YYYY-MM-DD).'),
  currency: CurrencySchema.default('USD'),
  supplierIds: z.array(z.string().min(1)).max(20).optional(),
  notes: z.string().max(1000).optional(),
});

const DecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});

const DevTokenSchema = z.object({
  role: z.enum(['ANALYST', 'APPROVER', 'ADMIN']),
  tenantId: z.string().min(1).default('tenant-demo'),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
});

export function buildServer(deps: ServerDeps): ServerHandle {
  const { core, services } = deps;
  const { config, logger, store } = core;
  const devTokensEnabled = deps.devTokenEnabled ?? config.auth.enableDevTokens;

  const app = Fastify({
    // No Fastify logger instance: the application logger is injected and used
    // explicitly, with a correlation id per request.
    bodyLimit: 256 * 1024,
    trustProxy: false,
    genReqId: () => randomUUID(),
  });

  // -------------------------------------------------------------------------
  // Cross-cutting hooks
  // -------------------------------------------------------------------------

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const origin = request.headers.origin;
    const allowed = new Set([...config.api.corsOrigins, config.api.appOrigin]);
    if (origin && allowed.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
    }
    if (request.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type,authorization,idempotency-key,last-event-id');
      reply.header('access-control-max-age', '600');
      await reply.code(204).send();
      return;
    }
    // A cross-origin browser mutation must come from a known origin
    // (defence in depth; the token is the primary control).
    if (origin && !allowed.has(origin) && request.method !== 'GET' && request.method !== 'HEAD') {
      throw forbidden('Requests from this origin are not accepted.');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error, request.id);
    const safeMessage = error instanceof Error ? error.message : String(error);
    if (status >= 500) {
      logger.error({ requestId: request.id, error: safeMessage, code: body.error.code }, 'request failed');
    } else {
      logger.warn({ requestId: request.id, code: body.error.code, status }, 'request rejected');
    }
    reply.code(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: ErrorCode.NOT_FOUND, message: `No route for ${request.method} ${request.url}.`, requestId: request.id },
    });
  });

  const routeLogger = (request: FastifyRequest): LoggerPort =>
    withContext(logger, { requestId: String(request.id) });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  async function authenticate(request: FastifyRequest, permission: Permission): Promise<AuthPrincipal> {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw unauthorized('An Authorization: Bearer token is required.');
    const claims = await verifyToken(token, config.auth);
    const user = await store.users.findBySubject(claims.subject);
    if (!user || !user.active) {
      throw unauthorized('The token subject is not an active user of this system.', ErrorCode.AUTHENTICATION_REQUIRED);
    }
    const principal: AuthPrincipal = {
      userId: user.id,
      subject: user.subject,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };
    assertPermission(principal, permission);
    return principal;
  }

  /** Analysts may only read resources that belong to their own runs. */
  async function assertRunReadable(run: RunRecord, principal: AuthPrincipal): Promise<void> {
    if (principal.role === 'ADMIN') return;
    if (run.ownerId === principal.userId) return;
    throw notFound('Run not found.');
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  app.get('/health/live', async () => ({ status: 'ok', service: 'api' }));

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let ready = true;
    try {
      await core.prisma.ping();
      checks.database = 'ok';
    } catch (error) {
      checks.database = `error: ${error instanceof Error ? error.message : 'unavailable'}`;
      ready = false;
    }
    try {
      await core.redis.ping();
      checks.redis = 'ok';
    } catch (error) {
      checks.redis = `error: ${error instanceof Error ? error.message : 'unavailable'}`;
      ready = false;
    }
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks };
  });

  // -------------------------------------------------------------------------
  // Local development tokens (disabled outside development)
  // -------------------------------------------------------------------------

  if (devTokensEnabled) {
    app.post('/api/auth/dev-token', async (request, reply) => {
      const body = DevTokenSchema.parse(request.body ?? {});
      const subject = body.subject ?? `local:${body.role.toLowerCase()}:${body.email ?? 'default'}`;
      const user = await store.users.upsert({
        tenantId: body.tenantId,
        subject,
        email: body.email ?? `${body.role.toLowerCase()}@example.test`,
        name: body.name ?? `${body.role} (local)`,
        role: body.role,
      });
      const token = await mintToken(
        { userId: user.id, subject: user.subject, tenantId: user.tenantId, email: user.email, role: user.role },
        config.auth,
      );
      reply.code(201);
      return {
        token,
        tokenType: 'Bearer',
        expiresInSeconds: 3600,
        user: { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email },
        warning: 'Development-only endpoint. Disable ENABLE_DEV_TOKENS outside local development.',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  app.post('/api/runs', async (request, reply) => {
    const principal = await authenticate(request, 'runs:create');
    const payload = RunRequestSchema.parse(request.body ?? {});
    if (payload.from > payload.to) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The analysis window is invalid: from must be on or before to.',
        category: 'VALIDATION',
        httpStatus: 400,
        retryable: false,
      });
    }
    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(idempotencyHeader) ? (idempotencyHeader[0] ?? null) : (idempotencyHeader ?? null);
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Idempotency-Key must be between 8 and 200 characters.',
        category: 'VALIDATION',
        httpStatus: 400,
        retryable: false,
      });
    }

    const result = await services.runs.submit({
      tenantId: principal.tenantId,
      userId: principal.userId,
      request: payload,
      idempotencyKey,
    });

    routeLogger(request).info({ runId: result.runId, idempotentReplay: result.idempotentReplay }, 'run accepted');
    reply.header('location', `${config.api.appOrigin}/api/runs/${result.runId}`);
    reply.code(202);
    return {
      runId: result.runId,
      status: result.status,
      idempotentReplay: result.idempotentReplay,
      links: {
        self: `/api/runs/${result.runId}`,
        steps: `/api/runs/${result.runId}/steps`,
        events: `/api/runs/${result.runId}/events`,
        stream: `/api/tasks/${result.runId}/stream`,
      },
    };
  });

  app.get('/api/runs', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const query = request.query as { limit?: string } | undefined;
    const limit = Math.min(Number(query?.limit ?? 25) || 25, 100);
    const runs = await services.runs.list(principal, limit);
    const visible = principal.role === 'ADMIN' ? runs : runs.filter((run) => run.ownerId === principal.userId);
    return { runs: visible.map(serializeRun) };
  });

  app.get('/api/runs/:id', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const run = await services.runs.get(id, principal);
    return serializeRun(run);
  });

  app.get('/api/runs/:id/steps', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const steps = await services.runs.steps(id, principal);
    return {
      runId: id,
      steps: steps.map((step) => ({
        stepId: step.id,
        sequence: step.sequence,
        attemptId: step.attemptId,
        type: step.stepType,
        status: step.status,
        summary: step.summary,
        payload: step.payload,
        errorCode: step.errorCode,
        errorMessage: step.errorMessage,
        retryable: step.retryable,
        latencyMs: step.latencyMs,
        createdAt: step.createdAt.toISOString(),
        completedAt: step.completedAt?.toISOString() ?? null,
      })),
    };
  });

  app.get('/api/runs/:id/events', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const query = request.query as { afterEventId?: string } | undefined;
    const events = await services.runs.events(id, principal, query?.afterEventId);
    return {
      runId: id,
      events: events.map((event) => ({
        eventId: event.id,
        sequence: event.sequence,
        type: event.eventType,
        version: event.version,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get('/api/runs/:id/audit', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    await services.runs.get(id, principal);
    const records = await store.audit.listByRun(id, 500);
    return {
      runId: id,
      audit: records.map((record) => ({
        auditId: record.id,
        actorType: record.actorType,
        actorId: record.actorId,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        metadata: record.metadata,
        createdAt: record.createdAt.toISOString(),
      })),
    };
  });

  app.get('/api/runs/:id/history', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const history = await services.runs.history(id, principal);
    return {
      runId: id,
      status: history.run.status,
      proposals: history.proposals.map((proposal) => ({
        proposalId: proposal.id,
        status: proposal.status,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        supplierId: proposal.supplierId,
        transactionId: proposal.transactionId,
        revision: proposal.revision,
        policyOutcome: proposal.policyDecision.outcome,
        policyVersion: proposal.policyVersion,
        requiresApproval: proposal.requiresApproval,
        createdAt: proposal.createdAt.toISOString(),
      })),
      approvals: history.approvals.map((approval) => ({
        approvalId: approval.id,
        proposalId: approval.proposalId,
        status: approval.status,
        expiresAt: approval.expiresAt.toISOString(),
        decidedAt: approval.decidedAt?.toISOString() ?? null,
        decidedBy: approval.decidedById,
        reason: approval.decisionReason,
      })),
      settlements: history.settlements.map((settlement) => ({
        operationId: settlement.operationId,
        status: settlement.status,
        ledgerEntryId: settlement.ledgerEntryId,
        attempts: settlement.attempts,
      })),
    };
  });

  app.post('/api/runs/:id/cancel', async (request) => {
    const principal = await authenticate(request, 'runs:cancel');
    const { id } = request.params as { id: string };
    const run = await services.runs.cancel(id, principal);
    return serializeRun(run);
  });

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------

  app.get('/api/tasks/:id/stream', async (request, reply) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const run = await services.runs.get(id, principal);
    await assertRunReadable(run, principal);
    routeLogger(request).debug({ runId: run.id }, 'event stream opened');
    await streamRunEvents(
      { store, logger: routeLogger(request), ...config.api.sse },
      request,
      reply,
      run.id,
    );
    return reply;
  });

  // -------------------------------------------------------------------------
  // Approvals, proposals, ledger
  // -------------------------------------------------------------------------

  app.get('/api/approvals/:id', async (request) => {
    const principal = await authenticate(request, 'approvals:read');
    const { id } = request.params as { id: string };
    const approval = await services.approvals.get(id, {
      userId: principal.userId,
      tenantId: principal.tenantId,
      role: principal.role,
    });
    return {
      approvalId: approval.id,
      runId: approval.runId,
      proposalId: approval.proposalId,
      status: approval.status,
      expiresAt: approval.expiresAt.toISOString(),
      proposalRevision: approval.proposalRevision,
      proposalHash: approval.proposalHash,
      reviewed: approval.reviewedSnapshot,
      decidedAt: approval.decidedAt?.toISOString() ?? null,
      decidedBy: approval.decidedById,
      reason: approval.decisionReason,
      links: {
        proposal: `/api/refund-proposals/${approval.proposalId}`,
        run: `/api/runs/${approval.runId}`,
      },
    };
  });

  app.post('/api/approvals/:id/decision', async (request, reply) => {
    const principal = await authenticate(request, 'approvals:decide');
    const { id } = request.params as { id: string };
    const body = DecisionSchema.parse(request.body ?? {});
    const result = await services.approvals.decide({
      approvalId: id,
      decision: body.decision,
      reason: body.reason ?? null,
      context: { userId: principal.userId, tenantId: principal.tenantId, role: principal.role },
    });
    routeLogger(request).info({ approvalId: id, decision: result.status, runId: result.runId }, 'approval decision recorded');
    reply.code(200);
    return {
      approvalId: result.approvalId,
      status: result.status,
      proposalId: result.proposalId,
      runId: result.runId,
      resumption: 'A durable resumption command was recorded in the same transaction as this decision.',
    };
  });

  app.get('/api/refund-proposals/:id', async (request) => {
    const principal = await authenticate(request, 'runs:read');
    const { id } = request.params as { id: string };
    const proposal = await store.proposals.findByIdForTenant(id, principal.tenantId);
    if (!proposal) throw notFound('Refund proposal not found.');
    if (principal.role !== 'ADMIN') {
      const run = await store.runs.findById(proposal.runId);
      if (!run || run.ownerId !== principal.userId) {
        // Approvers legitimately need to read a proposal they must decide on.
        const approval = await store.approvals.findByProposalId(proposal.id);
        if (!approval || principal.role !== 'APPROVER') throw notFound('Refund proposal not found.');
      }
    }
    const approval = await store.approvals.findByProposalId(proposal.id);
    const settlement = await store.settlements.findByProposalId(proposal.id);
    return {
      proposalId: proposal.id,
      runId: proposal.runId,
      status: proposal.status,
      supplierId: proposal.supplierId,
      transactionId: proposal.transactionId,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      refundableAmountMinor: proposal.refundableAmountMinor,
      justification: proposal.justification,
      evidence: proposal.evidence,
      revision: proposal.revision,
      reviewedHash: proposal.reviewedHash,
      requiresApproval: proposal.requiresApproval,
      policy: {
        version: proposal.policyVersion,
        outcome: proposal.policyDecision.outcome,
        decisionHash: proposal.policyDecision.decisionHash,
        checks: proposal.policyDecision.checks,
        denyReasons: proposal.policyDecision.denyReasons,
      },
      approval: approval
        ? { approvalId: approval.id, status: approval.status, expiresAt: approval.expiresAt.toISOString() }
        : null,
      settlement: settlement
        ? { operationId: settlement.operationId, status: settlement.status, ledgerEntryId: settlement.ledgerEntryId }
        : null,
      createdAt: proposal.createdAt.toISOString(),
    };
  });

  app.get('/api/ledger/operations/:id', async (request) => {
    const principal = await authenticate(request, 'ledger:read');
    const { id } = request.params as { id: string };
    const found = await services.settlements.getOperation(id, principal.tenantId);
    if (!found) throw notFound('Settlement operation not found.');
    if (principal.role !== 'ADMIN') {
      const run = await store.runs.findById(found.operation.runId);
      if (!run || run.ownerId !== principal.userId) {
        const approval = await store.approvals.findByProposalId(found.operation.proposalId);
        if (!approval || principal.role !== 'APPROVER') throw notFound('Settlement operation not found.');
      }
    }
    return {
      operationId: found.operation.operationId,
      proposalId: found.operation.proposalId,
      runId: found.operation.runId,
      status: found.operation.status,
      attempts: found.operation.attempts,
      lastError: found.operation.lastError,
      committedAt: found.operation.committedAt?.toISOString() ?? null,
      ledgerEntry: found.ledgerEntry
        ? {
            ledgerEntryId: found.ledgerEntry.id,
            entryType: found.ledgerEntry.entryType,
            amountMinor: found.ledgerEntry.amountMinor,
            currency: found.ledgerEntry.currency,
            supplierId: found.ledgerEntry.supplierId,
            memo: found.ledgerEntry.memo,
            entryHash: found.ledgerEntry.entryHash,
            createdAt: found.ledgerEntry.createdAt.toISOString(),
            simulated: true,
          }
        : null,
    };
  });

  return {
    app,
    close: async () => {
      await app.close();
    },
  };
}

export function serializeRun(run: RunRecord) {
  return {
    runId: run.id,
    tenantId: run.tenantId,
    ownerId: run.ownerId,
    taskType: run.taskType,
    status: run.status,
    request: run.request,
    policyVersion: run.policyVersion,
    attemptCount: run.attemptCount,
    attemptId: run.attemptId,
    tokenUsage: run.tokenUsage,
    result: run.result,
    error: run.errorCode ? { code: run.errorCode, message: run.errorMessage } : null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

export { isRole };
