# Architecture

**Resilient Multi-Step Financial Research & Settlement Agent** — a modular monolith
running as two processes (API + worker) over PostgreSQL and Redis/BullMQ.

This document explains *why* the system is shaped the way it does, what happens in each
failure mode, and where every requirement is implemented. The API contract is in
[API.md](API.md); the specification baseline is [../PRD.md](../PRD.md).

---

## 1. Topology

```
                    ┌──────────────────────────────┐
   HTTP / SSE       │  API process (Fastify)       │
  ─────────────────▶│  auth · routes · SSE tail    │
                    └───────┬──────────────┬───────┘
                            │              │
              (same DB txn) │              │ tail of run_events
                            ▼              │
                    ┌──────────────────┐   │   ┌───────────────────────┐
                    │   PostgreSQL     │◀──┼───│  Outbox dispatcher    │
                    │  source of truth│   │   │  (both processes)     │
                    └───────┬──────────┘   │   └───────────┬───────────┘
                            │              │               │ publish
                            │ load state   │               ▼
                            │              │        ┌──────────────┐
                            │              │        │ Redis/BullMQ │
                            │              │        └──────┬───────┘
                            │              │               │ run.execute / run.resume
                    ┌───────┴──────────────┴───────────────▼───────────┐
                    │  Worker process                                  │
                    │  workflow → agent runtime → policy → settlement  │
                    │  recovery sweep (also runs in the API process)   │
                    └──────────────────────────────────────────────────┘
```

* **Two long-lived processes.** The API never executes an agent; the worker never
  serves HTTP (SRS §10). Each process hosts the outbox dispatcher and recovery sweep,
  so running either one alone still makes progress — they coordinate through the
  database, not through memory.
* **PostgreSQL is authoritative.** Redis holds only identifiers and timing. A queue
  message can be lost, duplicated or delayed without loss of correctness (SRS §4.3).
* **SSE is a tail of a table.** Events are written by whichever process mutates state,
  and the stream reads them back. There is no in-memory event bus to lose.

## 2. Layering and the dependency rule

```
src/domain   pure: policy engine, state machines, anomaly rules, money, errors, ids
src/app      use-cases: services, ports (interfaces), agent runtime, tool registry
src/infra    adapters: Prisma store, BullMQ, Fastify+SSE, JWT auth, LLM providers, logs
src/config   one validated environment object
src/api, src/worker   process entrypoints (composition roots)
```

`domain` imports nothing from `app` or `infra`; `app` depends only on `domain` and on
port *interfaces*; `infra` implements those ports. Concretely this is what makes the
policy engine testable as a pure function, the Prisma store replaceable, and the LLM
provider swappable (`mock` ↔ `openai-compatible`) without touching business rules
(SRS §2.2).

`container.ts` is the single composition root: it builds the store, queue, runtime and
services once and hands them to both entrypoints.

## 3. The journey, step by step

| # | What happens | What is durable afterwards |
|---|---|---|
| 1 | `POST /api/runs` validates the payload (Zod), authenticates the principal, claims the `Idempotency-Key` | `runs` row in `PENDING`, `run_steps.RUN_ACCEPTED`, `outbox_events` row for `run.execute`, `idempotency_keys` record — **all in one transaction** |
| 2 | Outbox dispatcher publishes the message with a deterministic job id | `outbox_events.status = DISPATCHED` |
| 3 | Worker claims the run with a compare-and-set on `version` | `RUNNING`, `run.started` event, heartbeat |
| 4 | Agent loop: model → tool call → validation → tool execution → result | `run_steps.MODEL_TURN` / `TOOL_CALL` with latency, outcome, error code |
| 5 | Deterministic anomaly rules run over the retrieved window | findings with `ruleId` + referenced transaction ids |
| 6 | `create_refund_proposal` (restricted tool) resolves facts **from the database** and evaluates policy | `refund_proposals` row + `policy_decision` (version, checks, hash) |
| 7a | ≤ USD 500.00 → auto-allowed | proposal `APPROVED`, run continues to completion |
| 7b | > USD 500.00 → `approval_requests` row, run pauses | `REQUIRES_HUMAN_APPROVAL` persisted **before the worker releases its slot** (SRS-STATE-005) + `run.resume` outbox message prepared on decision |
| 8 | Approver posts a decision (permission `approvals:decide`) | approval `APPROVED`/`REJECTED` + audit + `run.resume` outbox row — **one transaction** |
| 9 | Dispatcher publishes `run.resume`; worker re-enters with a fresh attempt id | `RUNNING` again |
| 10 | Settlement service revalidates policy and approval against the *current* proposal revision and hash, derives the operation id, inserts the ledger entry | one `ledger_entries` row, `settlement_operations.COMMITTED` |
| 11 | Report is finalised and the run completes | `COMPLETED`, `run.completed` event, report in `runs.result` |

Steps 1, 7b, 8 and 10 are the ones that matter for correctness; each is described in
§5.

## 4. State machines

Only the application state-transition service mutates status (SRS-STATE-003), and every
transition is a conditional update on the row `version` (SRS-STATE-004). An illegal
transition is rejected *before* it reaches the database with `INVALID_STATE_TRANSITION`
(409).

**Run** (`src/domain/state.ts`)

```
PENDING ──▶ RUNNING ──▶ COMPLETED
   │          │  │  └──▶ FAILED ──▶ PENDING        (retryable failure, attempts left)
   │          │  └─────▶ REQUIRES_HUMAN_APPROVAL ─▶ RUNNING (on decision)
   │          └────────▶ CANCELLED
   ├───────────────────▶ FAILED / CANCELLED
   REQUIRES_HUMAN_APPROVAL ─▶ COMPLETED / FAILED / CANCELLED
COMPLETED, CANCELLED = terminal (never resumed by duplicate delivery)
```

**Proposal:** `DRAFT → REQUIRES_APPROVAL → APPROVED → SETTLED`, with terminal
`POLICY_DENIED`, `REJECTED`, `EXPIRED`, `CANCELLED`.

**Approval:** `PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED`.

**Settlement operation:** `PENDING → COMMITTED | FAILED`, plus `UNKNOWN → COMMITTED |
FAILED` for the reconcile path when a settlement outcome is uncertain (SRS §8).

Proposal and approval machines are modelled separately from the run: a proposal can be
rejected while the research run still completes with a report describing that outcome
(SRS §6).

## 5. Durability patterns

### 5.1 Transactional outbox (SRS-RUN-004)

Writing to the database and to Redis cannot be atomic. Instead the run row and its
outbox message commit together, and a dispatcher loop (`claimDueBatch` → publish →
`markDispatched`, exponential backoff capped at 60 s, bounded attempts) closes the gap.
A lost publish is retried; a crash between publish and mark produces a re-publish that
the deterministic job id absorbs.

The same mechanism carries `run.resume` after an approval decision (SRS-APPROVAL-007),
so a decision and its resumption can never be separated.

### 5.2 Idempotency at four layers

| Layer | Mechanism |
|---|---|
| Client request | `Idempotency-Key` + canonical request hash; identical replay returns the original run, a different payload with the same key returns `409 IDEMPOTENCY_KEY_REUSED` (PR-01) |
| Outbox message | unique `dedupeKey` (`execute:run:<id>:attempt:<attemptId>`) |
| Queue delivery | deterministic BullMQ job id; duplicate delivery of a terminal run records `run.duplicate_delivery_ignored` and does nothing (SRS-STATE-006) |
| Settlement | operation id derived from proposal id + revision + supplier + amount + currency, with a unique DB constraint (SRS-SETTLE-002/003) |

### 5.3 One attempt at a time

`RUNNING` means an attempt owns the run. A second delivery for the same run loses the
compare-and-set and is recorded as `ATTEMPT_IN_FLIGHT` — no double execution, no double
tool spend (tested).

### 5.4 Crash-window recovery (BUS-RULE-07 applied to the run)

An agent can die *after* recording a proposal or a settlement but *before* the run's
state change commits. On redelivery the workflow first inspects durable state:

* a **settled** proposal → the run completes from it (`RECOVERED_SETTLED`), no second
  research pass, no second proposal;
* a proposal **awaiting approval** → the pause is re-established;
* nothing recorded → the attempt runs normally.

This is why duplicate delivery after a crash cannot produce a conflicting proposal that
policy would have to deny.

### 5.5 Settlement atomicity and ledger immutability

`settle()`:

1. loads the existing operation — if it is already `COMMITTED`, returns the existing
   outcome instead of writing (`SETTLEMENT_OUTCOME_UNKNOWN` recovery path);
2. revalidates policy and approval against the *current* proposal revision/hash;
3. in one transaction inserts `ledger_entries` and marks the operation `COMMITTED`;
4. a unique violation on the operation id is caught and resolves to the existing entry.

The ledger is append-only: a migration installs triggers that reject `UPDATE` and
`DELETE` (both asserted by tests), plus CHECK constraints on amounts and statuses.

### 5.6 Approval binding

The approval stores the reviewed proposal's hash, revision, amount, currency and
supplier. `assertPolicyAllowsSettlement` refuses settlement if any of those changed
after review (`APPROVAL_HASH_MISMATCH`, SRS-POLICY-009), if the approval is not
`APPROVED`, or if policy has since turned to `DENY`.

## 6. Agent runtime

* **Registered tools only.** `ToolRegistry` holds six tools: `list_suppliers`,
  `list_transactions`, `get_transaction`, `detect_spend_anomalies`,
  `create_refund_proposal`, `finalize_research_report`. Calling anything else returns
  `TOOL_NOT_REGISTERED` (SRS-AGENT-001).
* **Validation in both directions.** Arguments are parsed with the tool's Zod schema
  before execution (`TOOL_ARGUMENT_INVALID`); results are validated before they are
  shown to the model (SRS-AGENT-002/003).
* **Effect declared per tool.** `READ` tools are pure queries; the only `WRITE` tools
  are `create_refund_proposal` and `finalize_research_report`, and neither can settle
  funds or grant approval. The LLM has no SQL access (SRS-AGENT-009).
* **Budgets** (PR-09): 6 tool calls (failed calls count), 30 s deadline (no new tool
  call after expiry → `EXECUTION_DEADLINE_EXCEEDED`), token budget (24 000 default),
  model retries (2), queue attempts (3) with backoff. Over-budget outcomes are
  deterministic `FAILED` states, not uncontrolled termination.
* **Untrusted data.** Retrieved descriptions are rendered as data, never as
  instructions; the report separates observed records from model interpretation
  (SRS-AGENT-010/011).
* **Providers.** `MockLlmProvider` drives the deterministic demo and every test, with
  injectable faults (provider errors, malformed output, timeouts). The
  OpenAI-compatible adapter normalises provider responses into internal types and maps
  provider failures onto controlled `PROVIDER_*` errors.

## 7. Policy engine

`src/domain/policy.ts` is pure: no clock, no I/O, no randomness ⇒ identical inputs and
policy version always yield the identical decision and decision hash (PR-06).

| Rule | Meaning |
|---|---|
| POL-001 | positive integer minor units |
| POL-002 | supported currency matching policy currency |
| POL-003 | source transaction exists in the caller's scope |
| POL-004 | supplier exists, active, and owns the transaction |
| POL-005 | amount ≤ refundable balance of the transaction |
| POL-006 | no conflicting in-flight/settled refund on the transaction |
| POL-007 | within the per-refund ceiling |
| POL-008 | > USD 500.00 requires human approval (boundary: exactly 500.00 does not) |
| POL-009 | transaction status permits a refund (`POSTED`) |

Money is integer minor units throughout (`src/domain/money.ts`) — no floats anywhere
(SRS-POLICY-003). The engine sees only facts resolved by the application layer from
PostgreSQL, so a model response cannot argue past a rule (SRS-AUTH-004,
SRS-POLICY-007).

## 8. Security model

* **Authentication:** HMAC-signed JWT (jose); claims are verified, then the principal
  is reloaded from the database by subject. Tenant, role and user id come from the
  token — never from a body, a model argument or a queue message (SRS-AUTH-004).
* **Authorization:** permission matrix in `src/infra/auth/jwt.ts`

  | Role | Permissions |
  |---|---|
  | ANALYST | `runs:create`, `runs:read`, `runs:cancel`, `approvals:read`, `ledger:read` |
  | APPROVER | `runs:read`, `approvals:read`, `approvals:decide`, `ledger:read` |
  | ADMIN | all, including `admin:read` |

  The analyst cannot approve (BUS-RULE-03); an approver cannot approve their own
  submission because submission requires `runs:create`, which they lack, and the
  decision endpoint additionally rejects the requester's identity.
* **Scoping:** every query filters by tenant, and reads are additionally checked
  against run ownership; a foreign run returns `404` (not `403`) so existence is not
  leaked (SRS-AUTH-005).
* **Cross-origin:** mutations from an origin outside `APP_ORIGIN`/`CORS_ORIGINS` are
  refused as defence in depth on top of the token.
* **Redaction:** log payloads pass through a redactor for token/secret-shaped fields;
  SSE payloads are a fixed allow-list of fields; error responses never contain driver
  messages or stacks (`INTERNAL_ERROR` is replaced with a generic message).

## 9. Events and SSE

* Events are appended with a per-run monotonic `sequence` and a stable id, **committed
  before** they can be streamed (SRS-EVENT-002).
* `GET /api/tasks/:id/stream` authorises, then tails the table at
  `SSE_POLL_INTERVAL_MS`, emitting `id:`, `event:` and `data:` frames with a
  versioned payload. `Last-Event-ID` (header or query) replays everything after that
  sequence — the same code path as `GET /api/runs/:id/events?afterEventId=`.
* Heartbeats (`: heartbeat`) every `SSE_HEARTBEAT_MS` keep intermediaries from
  dropping idle connections; `stream.closed` marks a clean end (SRS-EVENT-007).
* 20 event types cover the lifecycle (`run.started`, `run.awaiting_approval`,
  `proposal.created`, `policy.denied`, `approval.decided`, `settlement.committed`,
  `run.recovered`, `run.retry_scheduled`, …).

Because the stream is a table tail, a client that reconnects after a crash sees exactly
the events it missed — no loss, no in-memory broker required.

## 10. Recovery and operations

`RecoveryService` runs on an interval in both processes and, in one sweep:

| Action | Condition | Evidence |
|---|---|---|
| Expire approvals | `PENDING` past `expiresAt` (default 1 h) → `EXPIRED`, run resumes as *not approved* | `approval.expired` event, audit |
| Requeue stale attempts | `RUNNING` with no heartbeat for `STALE_ATTEMPT_MS` → back to `PENDING` with a fresh attempt id | `RECOVERY_REQUEUE` step, `run.recovered` |
| Fail exhausted runs | stale and attempts remaining = 0 → `FAILED` with a stable code | `run.failed` audit |
| Reconcile settlements | operation in `UNKNOWN` → inspect the durable row before any new write | `settlement.reconciled` |

Health: `/health/live` (process up) is distinct from `/health/ready` (PostgreSQL **and**
Redis answering), so an orchestrator never routes traffic to a process that cannot
serve it. Structured logs carry `requestId`, `runId`, `attemptId` for correlation
(SRS-OBS-001..004).

## 11. Failure modes

| Failure | Behaviour | Proof |
|---|---|---|
| HTTP client retries the same request | same run returned, no second execution | `idempotentReplay: true` in demo + integration test |
| Worker crashes mid-attempt | run stays durable; recovery requeues a fresh attempt; recorded outcome is honoured rather than re-researched | `tests/e2e/durability.test.ts` |
| Queue redelivers a terminal run's job | ignored and recorded | `tests/integration/workflow-resilience.test.ts` |
| Second worker picks up a running run | loses compare-and-set, no-op | same |
| Duplicate settlement delivery | second call resolves to the existing entry; unique constraint refuses a second row | `tests/integration/persistence.test.ts` |
| Approval decided twice concurrently | second decision gets `APPROVAL_NOT_PENDING` (409) | `tests/e2e/analyst-journey.test.ts` |
| Approval on a modified proposal | `APPROVAL_HASH_MISMATCH`, settlement refused | policy unit + approval tests |
| Model returns malformed tool args | `TOOL_ARGUMENT_INVALID`, counts against budget, run fails cleanly | `tests/unit/tool-registry.test.ts` |
| Model/provider outage | bounded retries with backoff, then `PROVIDER_ERROR` failure — never a silent partial settlement | mock-provider fault injection |
| Client disconnects from SSE | events keep accumulating; `Last-Event-ID` replays them | `tests/e2e/sse.test.ts` |
| Redis unavailable at submission | submission fails cleanly (`SERVICE_UNAVAILABLE`) rather than losing the run: the outbox row is committed first and dispatched later | outbox integration tests |
| Two test/dev environments share Redis | disjoint queue namespaces (`QUEUE_PREFIX`); a dev worker cannot consume test jobs | `tests/helpers/env.ts` |

## 12. Testing strategy

* **Unit (no infrastructure):** state machines, policy decisions, money arithmetic,
  anomaly rules, tool schemas, budgets, id hashing/redaction — the deterministic core.
* **Integration (PostgreSQL + Redis):** the *actual* constraints — transactions,
  compare-and-set, unique ledger entry, append-only triggers, CHECK constraints, outbox
  claim/lease, tenant scoping.
* **E2E (full topology):** the Fastify server, the real queue and worker loops in
  process, driving the journey over HTTP/SSE — including interruption, duplicate
  delivery, security and crash-window durability.

Files self-skip **with a printed reason** when infrastructure is missing, so a green run
that skipped a suite still reports the skip.

## 13. Requirements traceability

| Requirement | Implemented in | Verified by |
|---|---|---|
| BR-01/PR-01, SRS-RUN-001..007 | `infra/http/server.ts`, `app/services/run-service.ts` | e2e analyst journey, idempotency tests |
| BR-02/PR-02, SRS-QUEUE-001..006 | `infra/queue/bullmq.ts`, outbox dispatcher, workflow | integration resilience, e2e duplicate delivery |
| BR-03/PR-03/04, SRS-RESEARCH-001..006 | `app/tools/*`, `domain/anomaly.ts` | unit anomaly rules, e2e report assertions |
| BR-04/BR-05/PR-05/06, SRS-POLICY-001..009 | `domain/policy.ts`, `app/services/proposal-service.ts` | unit policy engine, e2e approval |
| BR-06/PR-07, SRS-APPROVAL-001..007, SRS-AUTH-* | `app/services/approval-service.ts`, `infra/auth/jwt.ts` | e2e security suite |
| BR-07/PR-08, SRS-SETTLE-001..007 | `app/services/settlement-service.ts`, ledger migration | integration settlement uniqueness |
| BR-08/PR-11, SRS-AUDIT-* | `app/services/telemetry.ts`, `audit_events` | `GET /api/runs/:id/audit` + tests |
| BR-09/PR-10, SRS-EVENT-001..007 | `infra/http/sse.ts`, `run_events` | e2e SSE replay/heartbeat |
| BR-10/PR-12, SRS-OBS-* | `recovery-service.ts`, `/health/*`, logger | e2e durability, recovery integration tests |
| BR-11, SRS-SETTLE-007 | simulated ledger only, synthetic seed | seed + ledger `simulated: true` |
| BR-12, SRS §9 | three Vitest projects + this documentation | `npm run verify` |

## 14. Decisions worth recording

1. **Transactional outbox over dual-write.** Direct Redis publishing would either lose
   messages or require distributed transactions; the outbox is retryable and auditable.
2. **Compare-and-set instead of locks.** Optimistic concurrency keeps the workflow
   lock-free and makes concurrent delivery a testable no-op rather than a deadlock.
3. **Deterministic operation ids over database sequences.** The id is derivable from the
   proposal itself, so idempotency survives truncation, restores and process restarts.
4. **Persist-then-publish events.** Streaming is a table tail, which is what makes
   replay and reconnect trivially correct.
5. **Purity for policy and anomaly rules.** Determinism is the only way a financial
   decision can be audited after the fact.
6. **Two processes, one codebase.** Microservice separation was explicitly out of
   scope for the MVP (BRD §6.2); the port/adapter structure keeps it open later.
