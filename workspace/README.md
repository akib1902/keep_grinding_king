# Resilient Multi-Step Financial Research & Settlement Agent

An asynchronous AI backend that turns a high-level financial research request into
evidence-backed anomaly findings, evidence-reviewed refund proposals, deterministic
policy decisions, human approval where required, and **exactly one** simulated ledger
settlement — while surviving worker crashes, queue redelivery, duplicate requests and
client disconnects.

The model proposes; deterministic services decide.

> **Scope:** MVP portfolio implementation. All financial data is synthetic and every
> settlement is simulated. No real payment rails, no live accounts, no compliance
> claims. See [Limitations](#limitations).

---

## What it does

1. An analyst submits a research request — `POST /api/runs` returns **202** and a run
   id immediately; the HTTP request does not wait for execution.
2. A worker executes the run with a bounded agent loop: read-only, schema-validated
   tools, a six-call budget, a 30-second deadline and a token budget.
3. Deterministic anomaly rules (reproducible from the same data) produce findings that
   reference the underlying transactions.
4. The agent may request a refund proposal through a restricted tool. The proposal is
   persisted with evidence — nothing is settled.
5. The policy engine evaluates it. Above **USD 500.00** the run pauses durably in
   `REQUIRES_HUMAN_APPROVAL` and an approval request is created.
6. An authorized approver — a different person from the requester — records a decision.
   The decision is bound to the reviewed proposal hash and revision.
7. The workflow resumes through a durable outbox message, revalidates policy and
   approval, and commits **one** ledger entry under a unique operation id.
8. Everything is replayable: steps, audit records, durable events, and an SSE stream
   with `Last-Event-ID` replay.

```bash
npm run demo          # walks this exact journey over HTTP and prints the audit trail
```

## Quick start

Requirements: **Node 22+**, **Docker** (PostgreSQL 16 + Redis).

```bash
npm install
cp .env.example .env            # defaults work as-is for local development
npm run infra:up                # postgres on :55432, redis on :56379
npm run infra:wait              # blocks until both answer
npm run db:migrate              # apply migrations
npm run db:test:prepare         # create + migrate the rfa_test database
npm run seed                    # 5 suppliers, 20 transactions, 3 demo users

npm run dev:api                 # terminal 1 — http://127.0.0.1:3100
npm run dev:worker              # terminal 2 — asynchronous run execution
npm run demo                    # terminal 3 — the end-to-end journey
```

The demo mints development tokens for an analyst and an approver, submits a Q3 spend
analysis, streams progress over SSE, shows the findings and proposal, records the
approval as the *other* user, proves an unauthorized attempt is refused, and prints the
single ledger entry plus the full audit trail.

```bash
npm run demo -- --no-approve   # stop at the approval pause (durably persisted)
npm run demo -- --reject       # reject instead: no settlement is created
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev:api` / `npm run dev:worker` | Run the two application processes (tsx watch) |
| `npm run build` | Compile to `dist/` (strict TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run infra:up` / `infra:down` / `infra:wait` | Docker Compose PostgreSQL + Redis |
| `npm run db:migrate` / `db:migrate:dev` / `db:reset` | Migrations |
| `npm run db:test:prepare` | Create and migrate the test database |
| `npm run seed` | Synthetic dataset + demo users |
| `npm run demo` | Live HTTP demonstration of the full journey |
| `npm run test` / `test:integration` / `test:e2e` / `test:all` | Vitest suites |
| `npm run verify` | Typecheck + full test suite |

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Submit a workflow (202 + `Idempotency-Key` support) |
| `GET` | `/api/runs` / `/api/runs/:id` | List / retrieve run state and result |
| `GET` | `/api/runs/:id/steps` | Ordered execution history |
| `GET` | `/api/runs/:id/events` | Replay durable events (`?afterEventId=`) |
| `GET` | `/api/runs/:id/audit` | Audit records for the run |
| `GET` | `/api/runs/:id/history` | Proposals, approvals and settlements for the run |
| `POST` | `/api/runs/:id/cancel` | Request safe cancellation |
| `GET` | `/api/tasks/:id/stream` | SSE progress stream with replay and heartbeats |
| `GET` | `/api/approvals/:id` | Approval request and reviewed snapshot |
| `POST` | `/api/approvals/:id/decision` | `APPROVE` / `REJECT` (permission checked) |
| `GET` | `/api/refund-proposals/:id` | Proposal, evidence and full policy evaluation |
| `GET` | `/api/ledger/operations/:id` | Simulated settlement operation + ledger entry |
| `GET` | `/health/live` / `/health/ready` | Liveness / readiness (DB + Redis) |
| `POST` | `/api/auth/dev-token` | Local development tokens only |

Full request/response contracts, the error-code catalog and the role matrix live in
[docs/API.md](docs/API.md).

## Architecture in one screen

```
client ──HTTP──▶ API process ──▶ PostgreSQL  (authoritative: runs, steps, events,
   │              │  │                            proposals, approvals, ledger,
   │              │  │                            outbox, idempotency keys, audit)
   │              │  └──transactional outbox──▶ Outbox dispatcher ──▶ BullMQ/Redis
   │              │                                                 │
   │              ◀────────────── SSE (persist-then-publish) ──┐     ▼
   │                                                          │  Worker process
   └──────────────────────────────────────────────────────────┘     │
                                                          Agent runtime (budgeted)
                                                          Policy engine (pure)
                                                          Settlement (unique op id)
```

* **PostgreSQL is the source of truth.** Redis carries only identifiers; a queue
  message is never proof of approval or settlement.
* **Transactional outbox** closes the database/queue dual-write gap: the run row and
  its `run.execute` message commit together, and a dispatcher retries publication.
* **Idempotency everywhere:** client idempotency keys, stable BullMQ job ids, unique
  outbox dedupe keys, a unique settlement operation id with a DB constraint, and an
  immutable ledger (UPDATE/DELETE blocked by triggers).
* **Recovery sweep** expires approvals, requeues stale attempts (no heartbeat) and
  fails runs that have exhausted attempts — each action audited.

More detail, including the state machines and the failure-mode table:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Safety controls

| Control | Where it lives |
|---|---|
| Approval required above USD 500.00 (strictly greater) | `src/domain/policy.ts` — pure, versioned, deterministic |
| Model cannot override policy | Facts are resolved from the DB, never from model arguments |
| Separation of duties | Analyst lacks `approvals:decide`; approver cannot be the requester |
| Approval bound to reviewed content | Proposal hash + revision re-checked before settlement |
| One settlement per operation | Unique constraint + append-only ledger triggers |
| Duplicate requests | `Idempotency-Key` with request-hash conflict detection |
| Bounded execution | 6 tool calls, 30 s deadline, token budget, model retries, queue attempts |
| Untrusted model/tool data | Zod validation both directions; registered tools only; no arbitrary SQL |
| Secret hygiene | Redaction in logs; SSE payloads filtered; error responses never leak internals |

## Testing

Three projects in one Vitest run ([vitest.config.ts](vitest.config.ts)):

| Project | What it proves | Infra |
|---|---|---|
| `unit` (104) | State machines, policy decisions, money math, anomaly rules, tool schemas, budgets, idempotency hashing, redaction | none |
| `integration` (45) | Transactions and constraints, optimistic concurrency, idempotency keys, outbox claim/dispatch, settlement uniqueness, ledger immutability, tenant scoping, approval/settlement boundaries | PostgreSQL + Redis |
| `e2e` (31) | Full journey, approval → single settlement, duplicate delivery, worker interruption and recovery, SSE replay, security and authorization, durability of the crash window | PostgreSQL + Redis |

```bash
npm run verify          # typecheck + everything
```

Integration and e2e files **self-skip with a printed reason** when infrastructure is
absent — a skip is reported as a limitation, never as a pass.

The suites run against `rfa_test` and a dedicated `rfa-test` Redis namespace, assigned
unconditionally in `tests/helpers/env.ts` (override with `TEST_QUEUE_PREFIX`). A dev
worker running at the same time therefore cannot consume test jobs: queue namespaces
are disjoint by construction.

## Configuration

Everything is validated at start-up by [`src/config/env.ts`](src/config/env.ts); a
missing or malformed value fails fast instead of at 3am. See
[.env.example](.env.example) for the documented defaults — API port `3100`, PostgreSQL
`55432`, Redis `56379`, agent budgets, policy threshold/version, approval TTL, recovery
intervals and SSE timings.

The LLM provider is pluggable:

* `LLM_PROVIDER=mock` (default) — fully deterministic, offline; used by tests and the demo.
* `LLM_PROVIDER=openai-compatible` — any `/chat/completions` endpoint with tool calling
  (OpenAI, Azure, vLLM, Ollama, gateways). Set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
  Credentials stay server-side.

## Project structure

```
src/
  domain/     pure policy, state machines, anomaly rules, money, errors, ids
  app/        ports, services (runs, proposals, approvals, settlement, workflow,
              outbox, recovery), agent runtime, tool registry
  infra/      Prisma store, BullMQ queue, Fastify server + SSE, JWT auth, LLM
              adapters, logging
  config/     validated environment configuration
  api/        API process entrypoint
  worker/     worker process entrypoint
prisma/       schema + migrations (including append-only ledger guards)
scripts/      seed, demo, infra wait, test-db prepare
tests/        unit / integration / e2e
docs/         ARCHITECTURE.md, API.md
```

## Requirements coverage

BRD / PRD / SRS are the specification baseline. Each section maps to code and tests —
see [docs/ARCHITECTURE.md § Traceability](docs/ARCHITECTURE.md#requirements-traceability).

## Limitations

* Simulated settlement only; the ledger holds synthetic entries and cannot pay anyone.
* The mock provider is deterministic by design; a real model is not — schema
  validation, budgets and deterministic verification contain the difference.
* Redis/BullMQ does not give exactly-once delivery; correctness comes from application
  idempotency plus database constraints, which is what the tests assert.
* Local portfolio implementation: not certified, not audited, not suitable for
  regulated financial operations without a separate security and compliance review.
* Performance figures quoted anywhere are measured on a local workload and are not
  guarantees.
