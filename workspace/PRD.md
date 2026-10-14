# Product Requirements Document (PRD)

## Resilient Multi-Step Financial Research & Settlement Agent

**Version:** 1.0  
**Status:** Proposed — MVP  
**Product Owner:** Project Owner  
**Target Platform:** Backend API and worker services  
**Primary Interface:** REST API, SSE event stream and approval endpoints

---

## 1. Product Vision

Build a reliable AI-enabled backend that transforms high-level financial research requests into structured findings and controlled, auditable workflows.

The product must combine flexible AI-driven reasoning with deterministic business controls. It should be able to analyze financial data, prepare refund proposals, pause for authorization, resume after approval and record simulated settlements without sacrificing consistency or accountability.

## 2. Target Users

### 2.1 Finance Analyst

Needs to analyze spending patterns, investigate supplier discrepancies and prepare evidence-backed recommendations.

### 2.2 Finance Manager / Approver

Needs to inspect a refund proposal, verify the supporting evidence, approve or reject the exact proposal and understand the consequences of the decision.

### 2.3 System Administrator

Needs to manage access, inspect execution failures and verify service health without bypassing financial controls.

### 2.4 Developer / Operator

Needs documented APIs, durable execution, reproducible tests and observability into asynchronous processing.

## 3. Product Principles

1. **AI proposes; deterministic services decide.**
2. **PostgreSQL is the source of truth.**
3. **Long-running operations must not depend on an HTTP request remaining open.**
4. **Sensitive operations require explicit authorization.**
5. **Retries must not duplicate financial outcomes.**
6. **Every important decision must be explainable from recorded evidence.**
7. **The MVP must be demonstrable without real financial integrations.**

## 4. MVP User Journey

1. The analyst submits a Q3 spending analysis request.
2. The API validates the request, creates a run and returns a task identifier.
3. A background worker processes the request.
4. The agent retrieves authorized transaction data and analyzes spending anomalies.
5. The agent produces findings and proposes a refund where evidence supports one.
6. The deterministic policy engine evaluates the proposal.
7. If the proposal exceeds USD 500, execution pauses and an approval request is created.
8. An authorized reviewer approves or rejects the proposal.
9. If approved, the worker resumes and revalidates the operation.
10. The simulated settlement is recorded once.
11. The final result and complete execution history are available through the API.

## 5. Functional Product Requirements

### PR-01: Request Submission

**Priority:** Must have

Users shall submit a structured financial research request through `POST /api/runs`.

The request must include a task description and any required analysis parameters, such as a date range and currency.

The API shall validate the request, authenticate the caller, persist the run and arrange asynchronous execution.

**Acceptance criteria:**
- Valid requests return `202 Accepted` and a stable run identifier.
- Invalid requests return a documented client error.
- Repeated requests with the same idempotency key and identical payload do not create duplicate logical runs.
- A different payload using the same idempotency key is rejected.

### PR-02: Asynchronous Processing

**Priority:** Must have

The system shall execute runs in a separate worker process using BullMQ.

**Acceptance criteria:**
- The HTTP response does not wait for agent completion.
- Worker execution status is persisted.
- Worker interruption does not erase the run.
- Recoverable jobs can resume or be retried safely.
- Duplicate queue delivery does not duplicate financial side effects.

### PR-03: Financial Research

**Priority:** Must have

The agent shall use explicitly registered, schema-validated read-only tools to retrieve and analyze transaction and supplier data.

**Acceptance criteria:**
- Research queries respect the caller's data permissions.
- Findings include references to relevant records.
- Malformed tool arguments are rejected.
- The agent cannot execute arbitrary SQL.
- The report distinguishes observed data from model-generated interpretations.

### PR-04: Anomaly Reporting

**Priority:** Must have

The system shall generate a structured report containing relevant transaction evidence, anomaly descriptions and proposed next steps.

Anomaly detection may begin with deterministic rules, such as duplicate invoice references, repeated charges, unusually large transactions or spending deviations from a defined baseline.

**Acceptance criteria:**
- Each reported anomaly includes its supporting record references.
- Rule-based findings can be reproduced from the same dataset and configuration.
- The report does not represent an anomaly as confirmed fraud without sufficient evidence.
- Findings can be retrieved after the worker finishes.

### PR-05: Refund Proposal Creation

**Priority:** Must have

The agent may request creation of a refund proposal through a restricted application tool.

A proposal must include supplier identity, source transaction, amount, currency, justification and evidence references.

**Acceptance criteria:**
- Proposal creation does not settle funds.
- Amount and currency are validated.
- The proposal is persisted with a unique identifier.
- Invalid or excessive proposals are rejected.
- The system records the policy evaluation associated with the proposal.

### PR-06: Deterministic Financial Policy

**Priority:** Must have

The policy service shall independently evaluate every proposed refund.

**Acceptance criteria:**
- Refunds exceeding USD 500 require human approval.
- Invalid supplier references and unauthorized operations are denied.
- The amount cannot exceed the permitted refundable balance.
- Policy decisions are deterministic for identical inputs and policy versions.
- The model cannot override the policy result.

### PR-07: Human Approval

**Priority:** Must have

Authorized reviewers shall be able to approve or reject proposals.

**Acceptance criteria:**
- Approval requests persist across worker restarts.
- The reviewer must authenticate and possess the appropriate permission.
- Approval is bound to the reviewed proposal version.
- Expired, rejected or cancelled proposals cannot be settled.
- Concurrent or repeated decisions cannot result in conflicting final outcomes.
- An approval event is recorded in the audit history.

### PR-08: Simulated Settlement

**Priority:** Must have

The system shall record approved settlement operations in a simulated ledger.

**Acceptance criteria:**
- Settlement is allowed only after the required authorization is verified.
- Each operation has a stable, unique operation ID.
- Replaying a settlement job does not create another ledger entry.
- Ledger records are immutable through ordinary application workflows.
- A transaction rollback does not leave a partially completed settlement.

### PR-09: Execution Budgets

**Priority:** Must have

The agent runtime shall enforce bounded execution.

Initial limits:
- Maximum six tool invocations per execution.
- Maximum 30 seconds for an execution attempt.
- Configurable token budget.
- Configurable model retry count.
- Bounded queue retries and backoff.

**Acceptance criteria:**
- Limits are enforced by runtime code.
- Failed tool invocations count toward the configured call budget.
- Expired execution deadlines prevent new tool calls.
- A paused approval workflow does not consume an active worker slot indefinitely.

### PR-10: Progress Streaming

**Priority:** Must have

Clients shall observe execution events through SSE.

**Acceptance criteria:**
- Events include a stable ID, timestamp, run ID and event type.
- Clients can reconnect and replay events after a known event ID.
- Heartbeats help detect broken connections.
- Events are persisted before publication.
- Sensitive information is not included in public event payloads.

### PR-11: Audit and Execution History

**Priority:** Must have

The system shall preserve the relevant history of execution, policy decisions, approvals and settlements.

**Acceptance criteria:**
- Run steps have ordered identifiers and execution statuses.
- Failures include stable error codes.
- Approval and settlement records reference the associated proposal and run.
- Authorized users can inspect the execution history.
- Secrets and unnecessary sensitive data are redacted.

### PR-12: Operational Visibility

**Priority:** Should have

The application shall expose health checks and structured operational telemetry.

**Acceptance criteria:**
- Liveness and readiness are distinguishable.
- Logs include request and run correlation IDs.
- Tool latency, execution duration, retries and failure counts can be measured.
- Logs do not contain API keys or unredacted credentials.

## 6. Product State Model

The run lifecycle shall support:

- `PENDING`
- `RUNNING`
- `REQUIRES_HUMAN_APPROVAL`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Transitions shall be enforced by a dedicated state transition service.

Approval rejection and expiry shall be represented explicitly in approval and proposal records. They must not be interpreted as successful completion.

## 7. API Product Surface

| Endpoint | Purpose |
|---|---|
| `POST /api/runs` | Submit a workflow |
| `GET /api/runs/:id` | Retrieve status and final result |
| `GET /api/runs/:id/steps` | Inspect execution steps |
| `GET /api/runs/:id/events` | Replay durable events |
| `GET /api/tasks/:id/stream` | Stream execution progress |
| `POST /api/runs/:id/cancel` | Request cancellation |
| `GET /api/approvals/:id` | Inspect an approval request |
| `POST /api/approvals/:id/decision` | Approve or reject |
| `GET /api/refund-proposals/:id` | Inspect proposal details |
| `GET /api/ledger/operations/:id` | Inspect simulated settlement |

## 8. Non-Functional Product Requirements

### Reliability

- Workflow state must survive process restarts.
- Queue retries must be bounded.
- Database constraints must protect settlement uniqueness.
- Recovery operations must be observable and auditable.

### Security

- Authentication and authorization are required.
- Tenant and user data access must be scoped.
- The LLM must not receive unrestricted database or settlement access.
- Approval decisions must be protected against replay and stale proposal versions.

### Performance

Initial measurable targets:
- API submission: p95 latency below 500 ms under a documented local test workload, excluding unavailable infrastructure and external processing.
- Agent execution: subject to the 30-second execution budget, except for paused approval workflows.
- SSE: deliver newly persisted events promptly under normal operation.

These targets must be validated by load tests; they are not assumed guarantees.

### Maintainability

- TypeScript strict mode.
- Modular domain, application and infrastructure layers.
- Automated tests and CI.
- Database migrations and versioned API contracts.
- Documented architectural decisions.

## 9. Prioritization

### P0 — Essential MVP

Asynchronous runs, persistent state, bounded agent runtime, read-only research tools, policy engine, approval workflow, simulated settlement, idempotency, SSE, audit history and integration tests.

### P1 — Portfolio Enhancements

OpenTelemetry traces, failure-injection tooling, richer anomaly rules, approval expiry automation, workload benchmarks and a lightweight review interface.

### P2 — Future Extensions

Additional financial data sources, multi-currency support, external accounting integrations, configurable organizational approval policies and production payment integrations subject to a separate security and compliance review.

## 10. Release Acceptance

The product is ready for its MVP demonstration when the end-to-end analyst-to-approval-to-settlement workflow passes, critical policy rules are covered by automated tests, recovery from worker interruption is demonstrated, and a fresh environment can reproduce the workflow using synthetic data.

## 11. Product Risks

- Unreliable model output: mitigate with schema validation and deterministic verification.
- Excessive scope: prioritize one complete vertical workflow.
- Duplicate operations: use idempotency and database constraints.
- Lost events: persist and replay events.
- Insecure approval: require authenticated authorization and proposal-specific decisions.
- Unclear results: include evidence references and explicit failure states.
