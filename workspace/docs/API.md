# API Reference

**Base URL (local):** `http://127.0.0.1:3100` (`APP_ORIGIN`)
**Content type:** `application/json` for everything except the SSE stream.
**Versioning:** the shapes below are the v1 contract; run and event payloads carry
`policyVersion` / `version` fields so clients can evolve with them.

---

## 1. Authentication

Every endpoint except `/health/live`, `/health/ready` and `/api/auth/dev-token`
requires:

```
Authorization: Bearer <jwt>
```

Tokens are HMAC-signed (issuer/audience from configuration) and the principal — user id,
tenant, role — is resolved from the database by the token subject, never from the
request body.

### Role and permission matrix

| Permission | ANALYST | APPROVER | ADMIN |
|---|:--:|:--:|:--:|
| `runs:create` | ✔ | — | ✔ |
| `runs:read` | ✔ | ✔ | ✔ |
| `runs:cancel` | ✔ | — | ✔ |
| `approvals:read` | ✔ | ✔ | ✔ |
| `approvals:decide` | — | ✔ | ✔ |
| `ledger:read` | ✔ | ✔ | ✔ |
| `admin:read` | — | — | ✔ |

Missing permission → `403 FORBIDDEN`. Missing/invalid token → `401`. A run belonging to
another user returns `404 NOT_FOUND` so resource existence is not leaked.

### Development tokens

```http
POST /api/auth/dev-token
content-type: application/json

{ "role": "ANALYST", "tenantId": "tenant-demo", "email": "analyst@example.test" }
```

`201` → `{ token, tokenType: "Bearer", expiresInSeconds, user, warning }`.
Available only when `ENABLE_DEV_TOKENS=true` (refused in production by configuration
validation). In a real deployment this endpoint is absent and tokens come from your IdP.

---

## 2. Error contract

Every failure uses the same envelope:

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "This idempotency key was already used with a different payload.",
    "category": "CONFLICT",
    "details": { "originalRunId": "..." },
    "requestId": "4b0f…"
  }
}
```

* `code` — stable, branch on it; `category` — VALIDATION, AUTHORIZATION, POLICY,
  CONFLICT, TRANSIENT, PROVIDER, TIMEOUT, BUDGET, INTERNAL.
* `requestId` is echoed in the `x-request-id` response header and in the structured
  log line for the same request.
* Internal messages, stacks and driver errors are never returned.

### Status codes

| Status | Meaning |
|---|---|
| `200` | successful retrieval or synchronous action |
| `201` | resource created synchronously (dev token) |
| `202` | run accepted for asynchronous execution |
| `400` | validation failure (Zod issues in `details.issues`) |
| `401` | missing/invalid authentication |
| `403` | insufficient permissions, disallowed origin |
| `404` | absent, or concealed (another user's resource) |
| `409` | idempotency conflict, illegal state transition, concurrent decision |
| `422` | valid syntax, invalid business input (policy/authorization refusal) |
| `429` | budget exceeded |
| `500` | unexpected internal failure (generic message) |
| `503` | required service unavailable (provider/Redis) |

### Error codes

| Category | Codes |
|---|---|
| Validation | `VALIDATION_FAILED` |
| Auth | `AUTHENTICATION_REQUIRED`, `TOKEN_INVALID`, `FORBIDDEN`, `NOT_FOUND` |
| Idempotency | `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` |
| State | `INVALID_STATE_TRANSITION`, `CONCURRENT_MODIFICATION`, `RUN_NOT_CANCELLABLE` |
| Policy | `POLICY_DENIED`, `SEPARATION_OF_DUTIES` |
| Approval | `APPROVAL_NOT_PENDING`, `APPROVAL_EXPIRED`, `APPROVAL_HASH_MISMATCH` |
| Settlement | `SETTLEMENT_PRECONDITION_FAILED`, `SETTLEMENT_OUTCOME_UNKNOWN` |
| Tools | `TOOL_NOT_REGISTERED`, `TOOL_ARGUMENT_INVALID`, `TOOL_EXECUTION_FAILED`, `TOOL_CALL_BUDGET_EXCEEDED` |
| Budgets | `TOKEN_BUDGET_EXCEEDED`, `EXECUTION_DEADLINE_EXCEEDED` |
| Provider | `MODEL_OUTPUT_INVALID`, `PROVIDER_ERROR`, `PROVIDER_TIMEOUT` |
| Infrastructure | `QUEUE_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR` |

---

## 3. Health

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Process is up. `200 {"status":"ok","service":"api"}` — never checks dependencies |
| `GET /health/ready` | PostgreSQL **and** Redis answer. `200 {"status":"ready","checks":{…}}` or `503 not_ready` with the failing check named |

---

## 4. Runs

### `POST /api/runs`

Submit a workflow. The response does **not** wait for the agent.

```http
POST /api/runs
Authorization: Bearer <analyst>
Idempotency-Key: 8b1f2f4c-…            (8–200 chars, optional but recommended)
content-type: application/json

{
  "task": "Analyse Q3 supplier spend, identify anomalies and prepare refund proposals.",
  "taskType": "SPEND_ANOMALY_RESEARCH",
  "from": "2026-07-01",
  "to": "2026-09-30",
  "currency": "USD",
  "supplierIds": ["sup_northwind"],
  "notes": "Focus on repeat invoices."
}
```

| Field | Rules |
|---|---|
| `task` | required, 10–2000 chars |
| `taskType` | `SPEND_ANOMALY_RESEARCH` (default) or `SUPPLIER_DISCREPANCY_REVIEW` |
| `from`, `to` | `YYYY-MM-DD`, `from ≤ to` (else `400`) |
| `currency` | supported currency, default `USD` |
| `supplierIds` | optional, ≤ 20 entries |
| `notes` | optional, ≤ 1000 chars |

`202 Accepted`:

```json
{
  "runId": "run_…",
  "status": "PENDING",
  "idempotentReplay": false,
  "links": {
    "self": "/api/runs/run_…",
    "steps": "/api/runs/run_…/steps",
    "events": "/api/runs/run_…/events",
    "stream": "/api/tasks/run_…/stream"
  }
}
```

`Location: <APP_ORIGIN>/api/runs/<runId>` is set on the response.

**Idempotency**

| Situation | Result |
|---|---|
| Same key, byte-identical canonical payload | `202`, original run id, `idempotentReplay: true` — no second run |
| Same key, different payload | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key while the original submission is still in flight | `409 IDEMPOTENCY_IN_PROGRESS` |
| Key shorter than 8 or longer than 200 chars | `400 VALIDATION_FAILED` |

### `GET /api/runs?limit=25`

Lists the caller's runs (`limit` ≤ 100; ADMIN sees all runs in the tenant).

### `GET /api/runs/:id`

```json
{
  "runId": "run_…", "tenantId": "tenant-demo", "ownerId": "usr_…",
  "taskType": "SPEND_ANOMALY_RESEARCH",
  "status": "REQUIRES_HUMAN_APPROVAL",
  "request": { "task": "…", "from": "2026-07-01", "to": "2026-09-30", "currency": "USD" },
  "policyVersion": "v1",
  "attemptCount": 1, "attemptId": "att_…",
  "tokenUsage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "modelTurns": 0 },
  "result": { "report": { "findings": [], "interpretation": {}, "limitations": [] } },
  "error": null,
  "createdAt": "…", "startedAt": "…", "completedAt": null
}
```

`status` ∈ `PENDING | RUNNING | REQUIRES_HUMAN_APPROVAL | COMPLETED | FAILED |
CANCELLED`. `result` is non-null once `COMPLETED`. `error` carries the stable code when
`FAILED`.

### `GET /api/runs/:id/steps`

Ordered execution history: `{ stepId, sequence, attemptId, type, status, summary,
payload, errorCode, errorMessage, retryable, latencyMs, createdAt, completedAt }`.

`type` ∈ `RUN_ACCEPTED, ATTEMPT_STARTED, MODEL_TURN, TOOL_CALL, RESEARCH_REPORT,
PROPOSAL_CREATED, POLICY_EVALUATION, APPROVAL_REQUIRED, APPROVAL_DECIDED, SETTLEMENT,
ATTEMPT_FAILED, RECOVERY_REQUEUE`.

### `GET /api/runs/:id/history`

Everything financial about the run in one call — proposals (with `policyOutcome`,
`policyVersion`, `requiresApproval`), approvals (with `decidedBy`), settlements (with
`ledgerEntryId`).

### `GET /api/runs/:id/events?afterEventId=<id>`

Durable event replay: `{ runId, events: [{ eventId, sequence, type, version, payload,
createdAt }] }`. Omit `afterEventId` for the full history; pass the last id you handled
to resume. This is the same data the SSE stream carries.

### `GET /api/runs/:id/audit`

Audit records: `{ auditId, actorType (USER|SYSTEM), actorId, action, targetType,
targetId, metadata, createdAt }` — capped at 500 newest records. Actions include
`run.completed`, `run.failed`, `run.awaiting_approval`, `approval.decided`,
`policy.denied`, `settlement.committed`, `run.recovered`.

### `POST /api/runs/:id/cancel`

Best-effort cancellation of a run that has not finished. Returns the updated run;
`409 RUN_NOT_CANCELLABLE` when the run is already terminal.

---

## 5. Progress streaming (SSE)

### `GET /api/tasks/:id/stream`

```http
GET /api/tasks/run_…/stream
Accept: text/event-stream
Authorization: Bearer <analyst>
Last-Event-ID: <last event id you processed>     # optional replay
```

(`?lastEventId=` / `?afterEventId=` query parameters are accepted as equivalents, so
replay also works from a plain link.)

Frames:

```
: stream open

id: evt_01J…
event: run.started
data: {"id":"evt_01J…","sequence":3,"eventType":"run.started","version":1,"payload":{…},"createdAt":"…"}

: heartbeat 2026-10-14T17:04:11.221Z

event: stream.closed
data: {"runId":"run_…","status":"COMPLETED"}
```

* **Replay:** everything after `Last-Event-ID` is sent first, then the stream tails the
  event table every `SSE_POLL_INTERVAL_MS` (default 500 ms).
* **Heartbeat:** comment frame every `SSE_HEARTBEAT_MS` (default 15 s) so clients and
  proxies detect dead connections.
* **Clean end:** `stream.closed` is emitted once the run is terminal and all events are
  flushed; the server then closes the connection.
* **Authorization:** the same run-ownership check as `GET /api/runs/:id`; an
  unauthorized stream is refused before headers are written.
* **Redaction:** payloads are an explicit field allow-list — no tokens, credentials or
  raw model chatter.

Event types: `run.accepted, run.started, run.awaiting_approval, run.resumed,
run.completed, run.failed, run.cancelled, run.recovered, run.retry_scheduled,
run.duplicate_delivery_ignored, run.resume_rearmed, proposal.created, policy.denied,
approval.required, approval.decided, approval.expired, settlement.committed,
settlement.refused, settlement.unknown, settlement.reconciled`.

---

## 6. Approvals

### `GET /api/approvals/:id`

```json
{
  "approvalId": "apr_…", "runId": "run_…", "proposalId": "prp_…",
  "status": "PENDING",
  "expiresAt": "2026-10-14T18:04:11.000Z",
  "proposalRevision": 1,
  "proposalHash": "sha256:…",
  "reviewed": { "amountMinor": 245000, "currency": "USD", "supplierId": "sup_…", "transactionId": "tx_…" },
  "decidedAt": null, "decidedBy": null, "reason": null,
  "links": { "proposal": "/api/refund-proposals/prp_…", "run": "/api/runs/run_…" }
}
```

### `POST /api/approvals/:id/decision`

```json
{ "decision": "APPROVE", "reason": "Evidence reviewed and refund authorised." }
```

`decision` ∈ `APPROVE | REJECT`; `reason` ≤ 500 chars.

`200`:

```json
{
  "approvalId": "apr_…", "status": "APPROVED", "proposalId": "prp_…", "runId": "run_…",
  "resumption": "A durable resumption command was recorded in the same transaction as this decision."
}
```

Behaviour guarantees:

| Situation | Result |
|---|---|
| Caller lacks `approvals:decide` (e.g. the analyst) | `403 FORBIDDEN` |
| Approval already decided, concurrently or repeatedly | `409 APPROVAL_NOT_PENDING` |
| Past `expiresAt` | `422 APPROVAL_EXPIRED` (an expired request can never be settled) |
| Proposal content changed since review | `409 APPROVAL_HASH_MISMATCH`; settlement performs the same check and refuses with `422 SETTLEMENT_PRECONDITION_FAILED` |
| Decision `APPROVE` | run resumes through the outbox; settlement follows only after revalidation |
| Decision `REJECT` | run completes with a report describing the rejection; **no** settlement |

The approval request and its resumption message commit in one transaction, so a decision
can never be recorded without the means to resume.

---

## 7. Refund proposals

### `GET /api/refund-proposals/:id`

```json
{
  "proposalId": "prp_…", "runId": "run_…", "status": "REQUIRES_APPROVAL",
  "supplierId": "sup_northwind", "transactionId": "tx_…",
  "amountMinor": 245000, "currency": "USD", "refundableAmountMinor": 245000,
  "justification": "Same invoice reference charged twice (ANOM-001).",
  "evidence": { "ruleId": "ANOM-001", "transactionIds": ["tx_20", "tx_21"], "observedAt": "…" },
  "revision": 1, "reviewedHash": "sha256:…", "requiresApproval": true,
  "policy": {
    "version": "v1", "outcome": "REQUIRES_APPROVAL", "decisionHash": "sha256:…",
    "checks": [ { "ruleId": "POL-001", "description": "…", "passed": true } ],
    "denyReasons": []
  },
  "approval": { "approvalId": "apr_…", "status": "PENDING", "expiresAt": "…" },
  "settlement": null,
  "createdAt": "…"
}
```

Amounts are integer **minor units** (`245000` = USD 2,450.00). Every policy rule is
returned with its result, so a reviewer can see exactly which rule produced the
outcome.

Policy rules: `POL-001` amount valid · `POL-002` currency · `POL-003` transaction exists
in scope · `POL-004` supplier valid and owns the transaction · `POL-005` within the
refundable balance · `POL-006` no conflicting refund · `POL-007` per-refund ceiling ·
`POL-008` approval threshold (> USD 500.00) · `POL-009` transaction refundable
(`POSTED`).

---

## 8. Ledger

### `GET /api/ledger/operations/:id`

```json
{
  "operationId": "op_…", "proposalId": "prp_…", "runId": "run_…",
  "status": "COMMITTED", "attempts": 1, "lastError": null,
  "committedAt": "…",
  "ledgerEntry": {
    "ledgerEntryId": "…", "entryType": "REFUND",
    "amountMinor": 245000, "currency": "USD",
    "supplierId": "sup_northwind", "memo": "…", "entryHash": "sha256:…",
    "createdAt": "…", "simulated": true
  }
}
```

* The operation id is **deterministic** for a given proposal revision, so repeating the
  settlement job resolves to this same record and never to a second ledger entry.
* `ledgerEntry` is `null` while the operation is `PENDING`/`FAILED`.
* `simulated: true` on every entry: the MVP never moves real money.
* Ledger rows are append-only (database triggers refuse `UPDATE`/`DELETE`).

---

## 9. Worked example (the whole journey)

```bash
# 1. tokens
ANALYST=$(curl -s localhost:3100/api/auth/dev-token -H 'content-type: application/json' \
  -d '{"role":"ANALYST","email":"analyst@example.test"}' | jq -r .token)
APPROVER=$(curl -s localhost:3100/api/auth/dev-token -H 'content-type: application/json' \
  -d '{"role":"APPROVER","email":"approver@example.test"}' | jq -r .token)

# 2. submit (202 + runId), replay safely with the same key
RUN=$(curl -s -X POST localhost:3100/api/runs -H "authorization: Bearer $ANALYST" \
  -H 'idempotency-key: demo-2026-10-14-001' -H 'content-type: application/json' \
  -d '{"task":"Analyse Q3 supplier spend and prepare refund proposals.","from":"2026-07-01","to":"2026-09-30"}')
RUN_ID=$(echo "$RUN" | jq -r .runId)

# 3. watch progress
curl -N "localhost:3100/api/tasks/$RUN_ID/stream" -H "authorization: Bearer $ANALYST"

# 4. inspect findings + proposal + approval
curl -s "localhost:3100/api/runs/$RUN_ID/history" -H "authorization: Bearer $ANALYST" | jq
APPROVAL=…  # from history.approvals[0].approvalId

# 5. decide as the approver (the analyst gets 403)
curl -s -X POST "localhost:3100/api/approvals/$APPROVAL/decision" \
  -H "authorization: Bearer $APPROVER" -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","reason":"Evidence reviewed."}' | jq

# 6. verify exactly one settlement
curl -s "localhost:3100/api/runs/$RUN_ID/history" -H "authorization: Bearer $ANALYST" | jq .settlements

# 7. audit trail
curl -s "localhost:3100/api/runs/$RUN_ID/audit" -H "authorization: Bearer $ANALYST" | jq
```

`npm run demo` performs exactly these steps and prints the annotated transcript.
