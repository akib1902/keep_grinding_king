/**
 * Runtime response validation (FDD §9.2).
 *
 * The frontend uses the backend's actual JSON contracts as its source of truth;
 * these schemas enforce the fields a screen cannot render correctly without, and
 * pass through anything else so additive backend changes never break the console.
 *
 * Deliberate choice: `status` fields are validated as strings rather than unions.
 * The FDD requires an unknown state to render as a safe fallback that preserves
 * the identifier (§13), which a strict enum would reject at the boundary instead.
 */
import { z } from 'zod';

const status = z.string().min(1);
const isoDate = z.string().min(1);

export const tokenResponseSchema = z
  .object({
    token: z.string().min(1),
    tokenType: z.literal('Bearer').default('Bearer'),
    expiresInSeconds: z.number().positive(),
    user: z
      .object({
        userId: z.string().min(1),
        tenantId: z.string().min(1),
        role: z.enum(['ANALYST', 'APPROVER', 'ADMIN']),
        email: z.string(),
      })
      .passthrough(),
    warning: z.string().default(''),
  })
  .passthrough();

export const readinessSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.record(z.string(), z.string()),
  })
  .passthrough();

export const anomalyFindingSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
    ruleVersion: z.string(),
    severity: z.string(),
    title: z.string(),
    observations: z.array(z.string()),
    evidence: z
      .object({
        transactionIds: z.array(z.string()).default([]),
        supplierIds: z.array(z.string()).default([]),
        metrics: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
      })
      .default({ transactionIds: [], supplierIds: [], metrics: {} }),
    refundEligible: z.boolean(),
    suggestedRefundMinor: z.number().int(),
  })
  .passthrough();

export const researchReportSchema = z
  .object({
    taskType: z.string(),
    window: z.object({ from: z.string(), to: z.string() }),
    transactionCount: z.number().int(),
    totalSpendMinor: z.number().int(),
    currency: z.string(),
    ruleVersion: z.string(),
    findings: z.array(anomalyFindingSchema),
    interpretation: z
      .object({
        model: z.string(),
        provider: z.string(),
        summary: z.string(),
        highlightedFindingIds: z.array(z.string()).default([]),
      })
      .passthrough(),
    limitations: z.array(z.string()).default([]),
    proposalIds: z.array(z.string()).default([]),
    approval: z
      .object({ approvalId: z.string(), status, proposalId: z.string(), reason: z.string().optional() })
      .passthrough()
      .optional(),
    settlement: z
      .object({
        operationId: z.string(),
        status,
        ledgerEntryId: z.string().nullable(),
        amountMinor: z.number().int(),
        currency: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const runSchema = z
  .object({
    runId: z.string().min(1),
    tenantId: z.string(),
    ownerId: z.string(),
    taskType: z.string(),
    status,
    request: z
      .object({
        task: z.string(),
        taskType: z.string(),
        from: z.string(),
        to: z.string(),
        currency: z.string(),
        supplierIds: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
      .passthrough(),
    policyVersion: z.string(),
    attemptCount: z.number().int(),
    attemptId: z.string().nullable().default(null),
    tokenUsage: z
      .object({
        promptTokens: z.number().int(),
        completionTokens: z.number().int(),
        totalTokens: z.number().int(),
        modelTurns: z.number().int(),
      })
      .passthrough()
      .nullable()
      .default(null),
    result: z.object({ report: researchReportSchema, generatedAt: isoDate }).nullable().default(null),
    error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
    createdAt: isoDate,
    startedAt: isoDate.nullable().default(null),
    completedAt: isoDate.nullable().default(null),
  })
  .passthrough();

export const runListSchema = z.object({ runs: z.array(runSchema) }).passthrough();

export const runStepSchema = z
  .object({
    stepId: z.string().min(1),
    sequence: z.number().int(),
    attemptId: z.string().nullable().default(null),
    type: z.string(),
    status,
    summary: z.string().nullable().default(null),
    payload: z.record(z.string(), z.unknown()).nullable().default(null),
    errorCode: z.string().nullable().default(null),
    errorMessage: z.string().nullable().default(null),
    retryable: z.boolean().nullable().default(null),
    latencyMs: z.number().nullable().default(null),
    createdAt: isoDate,
    completedAt: isoDate.nullable().default(null),
  })
  .passthrough();

export const runStepsSchema = z.object({ runId: z.string(), steps: z.array(runStepSchema) }).passthrough();

export const runEventSchema = z
  .object({
    eventId: z.string().min(1),
    sequence: z.number().int(),
    type: z.string(),
    version: z.number().int().default(1),
    payload: z.record(z.string(), z.unknown()).default({}),
    createdAt: isoDate,
  })
  .passthrough();

export const runEventsSchema = z.object({ runId: z.string(), events: z.array(runEventSchema) }).passthrough();

export const auditRecordSchema = z
  .object({
    auditId: z.string().min(1),
    actorType: z.string(),
    actorId: z.string().nullable().default(null),
    action: z.string(),
    targetType: z.string().nullable().default(null),
    targetId: z.string().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
    createdAt: isoDate,
  })
  .passthrough();

export const runAuditSchema = z.object({ runId: z.string(), audit: z.array(auditRecordSchema) }).passthrough();

export const runHistorySchema = z
  .object({
    runId: z.string(),
    status,
    proposals: z.array(
      z
        .object({
          proposalId: z.string(),
          status,
          amountMinor: z.number().int(),
          currency: z.string(),
          supplierId: z.string(),
          transactionId: z.string(),
          revision: z.number().int(),
          policyOutcome: z.string(),
          policyVersion: z.string(),
          requiresApproval: z.boolean(),
          createdAt: isoDate,
        })
        .passthrough(),
    ),
    approvals: z.array(
      z
        .object({
          approvalId: z.string(),
          proposalId: z.string(),
          status,
          expiresAt: isoDate,
          decidedAt: isoDate.nullable().default(null),
          decidedBy: z.string().nullable().default(null),
          reason: z.string().nullable().default(null),
        })
        .passthrough(),
    ),
    settlements: z.array(
      z
        .object({
          operationId: z.string(),
          status,
          ledgerEntryId: z.string().nullable().default(null),
          attempts: z.number().int(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const proposalDetailSchema = z
  .object({
    proposalId: z.string(),
    runId: z.string(),
    status,
    supplierId: z.string(),
    transactionId: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    refundableAmountMinor: z.number().int(),
    justification: z.string(),
    evidence: z.record(z.string(), z.unknown()).default({}),
    revision: z.number().int(),
    reviewedHash: z.string(),
    requiresApproval: z.boolean(),
    policy: z
      .object({
        version: z.string(),
        outcome: z.string(),
        decisionHash: z.string(),
        checks: z.array(z.object({ ruleId: z.string(), passed: z.boolean(), detail: z.string().optional() }).passthrough()),
        denyReasons: z.array(z.string()),
      })
      .passthrough(),
    approval: z.object({ approvalId: z.string(), status, expiresAt: isoDate }).passthrough().nullable().default(null),
    settlement: z
      .object({ operationId: z.string(), status, ledgerEntryId: z.string().nullable() })
      .passthrough()
      .nullable()
      .default(null),
    createdAt: isoDate,
  })
  .passthrough();

export const approvalDetailSchema = z
  .object({
    approvalId: z.string(),
    runId: z.string(),
    proposalId: z.string(),
    status,
    expiresAt: isoDate,
    proposalRevision: z.number().int(),
    proposalHash: z.string(),
    reviewed: z
      .object({
        proposalId: z.string(),
        revision: z.number().int(),
        reviewedHash: z.string(),
        supplierId: z.string(),
        supplierName: z.string().nullable().default(null),
        transactionId: z.string(),
        amountMinor: z.number().int(),
        currency: z.string(),
        refundableAmountMinor: z.number().int(),
        justification: z.string(),
        policyVersion: z.string(),
        policyOutcome: z.string(),
        evidence: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    decidedAt: isoDate.nullable().default(null),
    decidedBy: z.string().nullable().default(null),
    reason: z.string().nullable().default(null),
    links: z.object({ proposal: z.string(), run: z.string() }).passthrough().default({ proposal: '', run: '' }),
  })
  .passthrough();

export const decisionResultSchema = z
  .object({
    approvalId: z.string(),
    status,
    proposalId: z.string(),
    runId: z.string(),
    resumption: z.string().default(''),
  })
  .passthrough();

export const submitRunResultSchema = z
  .object({
    runId: z.string(),
    status,
    idempotentReplay: z.boolean(),
    links: z
      .object({ self: z.string(), steps: z.string(), events: z.string(), stream: z.string() })
      .passthrough()
      .default({ self: '', steps: '', events: '', stream: '' }),
  })
  .passthrough();

export const ledgerOperationSchema = z
  .object({
    operationId: z.string(),
    proposalId: z.string(),
    runId: z.string(),
    status,
    attempts: z.number().int(),
    lastError: z.string().nullable().default(null),
    committedAt: isoDate.nullable().default(null),
    ledgerEntry: z
      .object({
        ledgerEntryId: z.string(),
        entryType: z.string(),
        amountMinor: z.number().int(),
        currency: z.string(),
        supplierId: z.string(),
        memo: z.string().nullable().default(null),
        entryHash: z.string(),
        createdAt: isoDate,
        simulated: z.boolean().default(true),
      })
      .passthrough()
      .nullable()
      .default(null),
  })
  .passthrough();

/** The shape of a durable run event as delivered over SSE and `/events`. */
export const streamEventSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    sequence: z.number().int(),
    eventType: z.string(),
    version: z.number().int().default(1),
    payload: z.record(z.string(), z.unknown()).default({}),
    createdAt: isoDate,
  })
  .passthrough();

export type TokenResponseValidated = z.infer<typeof tokenResponseSchema>;
export type ReadinessValidated = z.infer<typeof readinessSchema>;
