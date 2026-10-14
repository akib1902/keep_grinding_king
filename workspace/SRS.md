# Software Requirements Specification (SRS)

## Resilient Multi-Step Financial Research & Settlement Agent

**Version:** 1.0  
**Status:** Proposed — MVP  
**Software Type:** Asynchronous AI-enabled backend system  
**Architecture:** Modular monolith with separate API and worker processes  
**Specification Basis:** Testable software requirements and interfaces

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional, interface, data, security, reliability and operational requirements for the Resilient Multi-Step Financial Research & Settlement Agent.

It provides an implementation and verification baseline for the MVP.

### 1.2 Scope

The software shall accept financial research requests, execute bounded agent workflows, produce anomaly findings, create refund proposals, apply deterministic policies, obtain human approval when required, and record authorized simulated settlements.

The software shall not transfer real money or connect to live payment rails in the MVP.

### 1.3 Definitions

- **Run:** A complete logical workflow initiated by a user.
- **Attempt:** One execution attempt for a run or resumable workflow segment.
- **Step:** A recorded unit of workflow activity.
- **Tool call:** A request from the agent runtime to an explicitly registered capability.
- **Proposal:** A structured recommendation to issue a refund.
- **Approval:** An authenticated human decision authorizing a specific proposal.
- **Settlement:** A simulated financial operation recorded in the ledger.
- **Idempotency:** The property that repeating the same logical operation does not create duplicate effects.
- **Outbox:** A durable record of a message that must be published to an asynchronous queue.
- **SSE:** Server-Sent Events, an HTTP-based mechanism for streaming server-to-client events.

## 2. System Overview

### 2.1 Logical Components

1. API service.
2. Authentication and authorization service.
3. Run orchestration service.
4. Agent runtime and LLM adapter.
5. Typed tool registry.
6. Financial policy engine.
7. Approval workflow service.
8. Settlement service and simulated ledger.
9. PostgreSQL persistence layer.
10. Redis/BullMQ job infrastructure.
11. Transactional outbox dispatcher and recovery worker.
12. Durable event store and SSE endpoint.
13. Logging and telemetry components.

### 2.2 Technology Constraints

- Language: TypeScript with strict type checking.
- HTTP framework: Fastify.
- Database: PostgreSQL.
- ORM: Prisma.
- Job queue: Redis and BullMQ.
- Request and tool validation: Zod.
- Testing: Vitest.
- Local dependency orchestration: Docker Compose.
- Streaming protocol: SSE.
- AI integration: provider adapter supporting structured output or tool calling.

The architecture shall keep business rules independent of HTTP routing, persistence implementation and the selected LLM provider.

## 3. Functional Requirements

### 3.1 Authentication and Authorization

**SRS-AUTH-001:** The API shall authenticate protected requests before accessing protected resources.

**SRS-AUTH-002:** The API shall enforce resource ownership and the permissions required for each operation.

**SRS-AUTH-003:** The approval endpoint shall verify the reviewer's approval permission independently of the requesting user's identity.

**SRS-AUTH-004:** The system shall not trust a user ID, tenant ID, supplier scope or approval status supplied solely through an LLM-generated argument.

**SRS-AUTH-005:** Unauthorized access shall fail without exposing protected resource contents.

### 3.2 Run Submission

**SRS-RUN-001:** The API shall accept a valid run submission through `POST /api/runs`.

**SRS-RUN-002:** The API shall validate the task description, analysis parameters and request size.

**SRS-RUN-003:** The API shall create the initial run in `PENDING` state.

**SRS-RUN-004:** The API shall durably arrange execution through a transactional outbox or an equivalent mechanism that closes the database-to-queue dual-write failure gap.

**SRS-RUN-005:** The API shall return `202 Accepted` with the run identifier and a resource location.

**SRS-RUN-006:** The API shall implement request idempotency using a client-supplied idempotency key.

**SRS-RUN-007:** Reusing an idempotency key with a different canonical request hash shall return a documented conflict response.

### 3.3 Run State Management

**SRS-STATE-001:** The run state machine shall permit only explicitly defined transitions.

**SRS-STATE-002:** The run shall not transition directly from `PENDING` to `COMPLETED` without executing the required workflow logic.

**SRS-STATE-003:** Only the application state transition service shall modify run status.

**SRS-STATE-004:** State transitions shall be protected against concurrent modification through conditional updates, optimistic concurrency control or database locking.

**SRS-STATE-005:** A run requiring human approval shall be persisted before the worker releases execution resources.

**SRS-STATE-006:** Terminal runs shall not resume through ordinary duplicate queue delivery.

**SRS-STATE-007:** Failed, cancelled, rejected or expired operations shall not be interpreted as successful settlement.

### 3.4 Background Execution

**SRS-QUEUE-001:** The system shall process runs through a worker independent of the HTTP request lifecycle.

**SRS-QUEUE-002:** The worker shall persist attempt status and step outcomes.

**SRS-QUEUE-003:** The worker shall use bounded retry policies with backoff for retryable failures.

**SRS-QUEUE-004:** The worker shall not retry non-retryable authorization or policy failures automatically.

**SRS-QUEUE-005:** The system shall detect and reconcile stale or orphaned work using a recovery process.

**SRS-QUEUE-006:** Queue messages shall contain stable run or operation identifiers rather than serve as the authoritative business record.

### 3.5 Agent Runtime

**SRS-AGENT-001:** The agent runtime shall invoke only registered tools.

**SRS-AGENT-002:** The runtime shall validate model-generated tool arguments against a schema before execution.

**SRS-AGENT-003:** The runtime shall validate tool results before passing them back to the model.

**SRS-AGENT-004:** The runtime shall enforce a maximum of six tool invocations per execution attempt.

**SRS-AGENT-005:** The runtime shall enforce a 30-second execution deadline for an attempt.

**SRS-AGENT-006:** The runtime shall enforce a configurable token budget.

**SRS-AGENT-007:** The runtime shall persist tool invocation metadata, outcomes, errors and latency.

**SRS-AGENT-008:** The runtime shall handle malformed output, timeouts, provider errors and tool failures without uncontrolled worker termination.

**SRS-AGENT-009:** The runtime shall not provide unrestricted database write access to the LLM.

**SRS-AGENT-010:** The runtime shall treat retrieved financial descriptions and documents as untrusted input.

**SRS-AGENT-011:** The runtime shall distinguish factual findings backed by records from model-generated interpretations.

### 3.6 Research and Anomaly Analysis

**SRS-RESEARCH-001:** The system shall provide a read-only transaction query capability.

**SRS-RESEARCH-002:** The system shall provide a read-only supplier query capability.

**SRS-RESEARCH-003:** The system shall support configurable, reproducible anomaly detection rules.

**SRS-RESEARCH-004:** Each finding shall reference the supporting records or rule outputs.

**SRS-RESEARCH-005:** The system shall not characterize a suspicious transaction as confirmed fraud solely because the model labels it anomalous.

**SRS-RESEARCH-006:** The system shall persist the final report and its relevant evidence references.

### 3.7 Refund Proposals and Financial Policy

**SRS-POLICY-001:** The system shall create refund proposals through a restricted application service.

**SRS-POLICY-002:** The system shall validate supplier identity, transaction identity, amount, currency and refundable balance.

**SRS-POLICY-003:** The system shall represent monetary values using integer minor units or another explicitly defined exact-decimal representation.

**SRS-POLICY-004:** The policy engine shall require human approval for proposals greater than USD 500.

**SRS-POLICY-005:** The policy engine shall return a deterministic allow, deny or approval-required decision.

**SRS-POLICY-006:** The policy engine shall record the policy version and decision associated with each proposal.

**SRS-POLICY-007:** The system shall prevent an LLM response from overriding a policy decision.

**SRS-POLICY-008:** The system shall revalidate the proposal and its authorization immediately before settlement.

**SRS-POLICY-009:** The system shall reject stale approval decisions if the proposal's reviewed fields or version have changed.

### 3.8 Human Approval

**SRS-APPROVAL-001:** The system shall persist approval requests with their associated proposal, status and expiry.

**SRS-APPROVAL-002:** The system shall support approval and rejection through an authenticated endpoint.

**SRS-APPROVAL-003:** The system shall record the decision maker, decision timestamp and decision outcome.

**SRS-APPROVAL-004:** The system shall prevent conflicting concurrent decisions for the same approval request.

**SRS-APPROVAL-005:** The system shall reject decisions on expired, cancelled or already-finalized requests.

**SRS-APPROVAL-006:** An approval callback URL shall not itself confer approval authority.

**SRS-APPROVAL-007:** A persisted approval decision shall trigger a durable workflow-resumption command when resumption is applicable.

### 3.9 Simulated Settlement

**SRS-SETTLE-001:** The system shall settle only proposals that satisfy the required policy and approval conditions.

**SRS-SETTLE-002:** Each settlement shall use a stable, unique operation identifier.

**SRS-SETTLE-003:** The system shall enforce a database uniqueness constraint on the settlement operation identifier.

**SRS-SETTLE-004:** The settlement record and associated operation state shall be committed atomically within the relevant database transaction.

**SRS-SETTLE-005:** A duplicate settlement request shall return or resolve to the existing logical outcome rather than create a second ledger entry.

**SRS-SETTLE-006:** The ledger shall not be directly writable by the LLM.

**SRS-SETTLE-007:** The MVP shall not execute real payments or transfer actual funds.

### 3.10 Event Persistence and SSE

**SRS-EVENT-001:** The system shall persist run events with stable identifiers and sequence information.

**SRS-EVENT-002:** The system shall persist an event before making it available for streaming.

**SRS-EVENT-003:** The SSE endpoint shall emit event IDs, event types and versioned payloads.

**SRS-EVENT-004:** The SSE endpoint shall support replay from a client-provided last event ID.

**SRS-EVENT-005:** The system shall enforce authorization before streaming a run's events.

**SRS-EVENT-006:** The system shall avoid exposing secrets and unnecessary sensitive information through event payloads.

**SRS-EVENT-007:** The SSE endpoint shall support heartbeats and clean connection termination.

### 3.11 Audit and Observability

**SRS-AUDIT-001:** The system shall record run creation, state transitions, tool activity, policy decisions, approval decisions and settlement outcomes.

**SRS-AUDIT-002:** Audit records shall reference the relevant run and operation identifiers.

**SRS-AUDIT-003:** Ordinary application workflows shall not permit arbitrary modification or deletion of completed ledger records.

**SRS-OBS-001:** The system shall emit structured logs with correlation identifiers.

**SRS-OBS-002:** The system shall expose liveness and readiness health checks.

**SRS-OBS-003:** The system shall measure execution duration, tool latency, retry counts and token usage where available.

**SRS-OBS-004:** The system shall redact credentials, authorization tokens and other configured sensitive values from logs.

## 4. External Interface Requirements

### 4.1 HTTP API

All API requests and responses shall use JSON except for SSE streams.

The API shall use consistent error responses containing a stable error code, a safe human-readable message and a correlation identifier where applicable.

Suggested status codes:

- `200 OK`: Successful retrieval or completed synchronous action.
- `201 Created`: Resource created synchronously where appropriate.
- `202 Accepted`: Run or other asynchronous operation accepted.
- `400 Bad Request`: Invalid request syntax or parameters.
- `401 Unauthorized`: Missing or invalid authentication.
- `403 Forbidden`: Insufficient permissions.
- `404 Not Found`: Resource absent or intentionally concealed.
- `409 Conflict`: Idempotency conflict or incompatible resource state.
- `422 Unprocessable Content`: Valid request syntax but invalid business input.
- `429 Too Many Requests`: Rate or resource limit exceeded.
- `500 Internal Server Error`: Unexpected internal failure.
- `503 Service Unavailable`: Required service unavailable.

### 4.2 API Endpoints

| Method | Endpoint | Required behavior |
|---|---|---|
| POST | `/api/runs` | Validate, persist and enqueue a run |
| GET | `/api/runs/:id` | Return authorized run state and result |
| GET | `/api/runs/:id/steps` | Return authorized step history |
| GET | `/api/runs/:id/events` | Replay persisted events |
| GET | `/api/tasks/:id/stream` | Stream authorized SSE events |
| POST | `/api/runs/:id/cancel` | Request safe cancellation |
| GET | `/api/approvals/:id` | Return approval details |
| POST | `/api/approvals/:id/decision` | Record an authorized decision |
| GET | `/api/refund-proposals/:id` | Return proposal and evidence |
| GET | `/api/ledger/operations/:id` | Return simulated settlement status |

### 4.3 Queue Interface

Queue messages shall use versioned payloads containing stable identifiers, such as `runId`, `attemptId` or `operationId`.

Queue messages shall not be treated as proof of approval or settlement authorization. The worker must load authoritative state and verify preconditions before acting.

### 4.4 LLM Interface

The model adapter shall accept structured context and a registered tool definition set.

The adapter shall normalize provider responses into internal types and convert provider-specific failures into controlled application errors.

Provider credentials shall remain server-side.

## 5. Data Requirements

### 5.1 Logical Data Model

| Entity | Required fields / purpose |
|---|---|
| `users` | User identity, authentication subject and role assignments |
| `runs` | ID, owner, status, request payload, token usage and timestamps |
| `run_steps` | Run ID, sequence, attempt ID, step type, payloads, status and latency |
| `run_events` | Run ID, event sequence, event type, version and payload |
| `outbox_events` | Message ID, event type, payload, dispatch status and retry metadata |
| `idempotency_keys` | Scope, key, request hash, status and stored outcome |
| `suppliers` | Supplier identifiers and permitted descriptive information |
| `transactions` | Transaction ID, supplier, amount, currency, date and invoice reference |
| `refund_proposals` | Source transaction, supplier, amount, currency, evidence and version |
| `approval_requests` | Proposal, reviewer, status, expiry and decision timestamp |
| `ledger_entries` | Operation ID, supplier, amount, currency and immutable entry metadata |

### 5.2 Database Constraints

- Primary keys shall uniquely identify records.
- Foreign keys shall enforce relationships where applicable.
- Amounts shall satisfy positive-value and business-limit constraints.
- Run and approval statuses shall be constrained to supported values.
- Idempotency keys shall be unique within their defined scope.
- Settlement operation IDs shall be unique.
- Event sequence identifiers shall be unique within their required scope.
- Indexes shall support run ownership, active status, event replay and recovery queries.

### 5.3 Data Integrity

The system shall use database transactions for related state changes.

The settlement service shall atomically insert the unique ledger entry and update the associated operation state. The approval decision and workflow-resumption message shall be persisted using an appropriate transaction and outbox pattern.

The system shall not rely exclusively on Redis state for authorization, approval status or settlement completion.

### 5.4 Data Retention

The MVP shall document retention assumptions for run history, model outputs, audit records and synthetic financial data.

Deletion, redaction and retention behavior must not undermine financial record integrity or applicable access-control requirements.

## 6. State Transition Requirements

The primary run states are:

- `PENDING`
- `RUNNING`
- `REQUIRES_HUMAN_APPROVAL`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

The application shall define and test permitted transitions, including recovery and resumption.

The proposal and approval state machines shall be modeled separately from the run state machine. For example, a proposal can be rejected while the overall research run subsequently completes with a report describing that outcome.

State changes shall be persisted before corresponding events are published.

## 7. Non-Functional Requirements

### 7.1 Performance

- The API should return accepted run submissions within a target p95 of 500 ms under a documented local workload.
- Agent execution attempts shall enforce the configured 30-second deadline.
- SSE connections shall not block background workers.
- Query and event replay performance shall be measured under representative test data.
- No performance target shall override correctness or authorization requirements.

### 7.2 Reliability

- PostgreSQL shall be the authoritative store for durable business state.
- The outbox dispatcher shall retry transient publication failures.
- Recovery routines shall identify stale or orphaned work.
- Worker restarts shall not erase approval decisions or completed ledger entries.
- Duplicate message delivery shall not create duplicate financial outcomes.

### 7.3 Security

- All protected operations shall require authentication and authorization.
- All resource queries shall enforce the applicable user and tenant scope.
- Secrets shall not be committed to the repository.
- Tool inputs and outputs shall be validated.
- External content shall be treated as untrusted.
- Approval and settlement operations shall be protected against replay and unauthorized access.
- Logs and SSE payloads shall be subject to redaction rules.

### 7.4 Maintainability

- The codebase shall use TypeScript strict mode.
- Domain policy shall be independent of the HTTP and LLM providers.
- Database changes shall use versioned migrations.
- API schemas and errors shall be documented.
- CI shall run formatting or linting, type checks, automated tests and migration validation.

### 7.5 Portability

The system shall be runnable locally through documented setup instructions and Docker Compose for PostgreSQL and Redis. It shall not require access to live financial services.

## 8. Error Handling

Errors shall be classified into validation, authorization, policy, transient infrastructure, provider, timeout, conflict and internal categories.

Each failure shall have a stable code suitable for logs, tests and client handling.

The internal tool result contract shall distinguish successful results from errors and indicate whether a failure is retryable.

Retry decisions shall be made by the runtime and workflow policy, not solely by the model.

When a settlement outcome is uncertain, the system shall inspect the durable operation record before attempting another write.

## 9. Testing and Verification

### 9.1 Unit Tests

- State transition rules.
- Financial policy decisions.
- Monetary validation.
- Tool argument schemas.
- Execution budget enforcement.
- Idempotency-key behavior.

### 9.2 Integration Tests

- PostgreSQL transactions and constraints.
- Redis/BullMQ processing.
- Outbox dispatch and recovery.
- SSE event persistence and replay.
- Approval and settlement transaction boundaries.

### 9.3 End-to-End Tests

- Request submission through completed research.
- Refund proposal requiring approval.
- Authorized approval and simulated settlement.
- Rejected and expired approval paths.
- Worker interruption and safe recovery.
- Duplicate jobs and repeated settlement requests.

### 9.4 Security Tests

- Unauthorized access to another user's run.
- Unauthorized approval attempts.
- Tampered proposal versions.
- Prompt injection through retrieved data.
- Attempts to invoke unregistered tools.
- Secret leakage through logs or SSE.

### 9.5 Acceptance Verification

The release shall not be considered accepted until the critical policy, authorization, idempotency and settlement tests pass, and the end-to-end workflow is reproducible from a clean environment.

## 10. Deployment and Operations

The MVP shall run as at least two application processes:

1. API process for HTTP routes and SSE.
2. Worker process for asynchronous run execution.

PostgreSQL and Redis shall be separate infrastructure dependencies.

The deployment shall provide environment-based configuration, health checks, graceful shutdown, structured logs and documented database migrations.

The worker shall stop accepting new work during graceful shutdown and allow in-progress operations to finish or recover safely.

## 11. Constraints and Limitations

- The MVP uses simulated settlement only.
- External model responses are not assumed to be deterministic.
- Redis/BullMQ does not guarantee exactly-once job delivery.
- Idempotent business effects must be enforced by application logic and database constraints.
- The 30-second execution deadline applies to a bounded attempt, not the total lifetime of a run awaiting human approval.
- Performance and security claims require evidence from testing.
- A local portfolio implementation is not automatically suitable for regulated production financial operations.

## 12. Requirements Traceability

| Business requirement | Product requirement | SRS coverage |
|---|---|---|
| BR-01 | PR-01 | SRS-RUN |
| BR-02 | PR-02 | SRS-QUEUE |
| BR-03 | PR-03, PR-04 | SRS-RESEARCH |
| BR-04 | PR-05 | SRS-POLICY |
| BR-05 | PR-06 | SRS-POLICY |
| BR-06 | PR-07 | SRS-APPROVAL, SRS-AUTH |
| BR-07 | PR-08 | SRS-SETTLE |
| BR-08 | PR-11 | SRS-AUDIT |
| BR-09 | PR-10 | SRS-EVENT |
| BR-10 | PR-02, PR-12 | SRS-QUEUE, SRS-OBS |
| BR-11 | PR-08 | SRS-SETTLE |
| BR-12 | PR-12 | SRS-OBS and testing requirements |

## 13. Completion Criteria

The SRS is satisfied when the implementation fulfills the defined functional and non-functional requirements, the critical tests pass, the traceability matrix is maintained, and the documented end-to-end workflow can be reproduced without real financial integrations.
