# LedgerFlow — web console

The frontend for the Resilient Multi-Step Financial Research & Settlement Agent:
a Next.js application that submits research runs, follows their execution, reviews
evidence, authorises refund proposals and inspects simulated settlements.

It implements the Frontend Design Document (`../FDD.md`). Nothing on this screen
decides anything: the Fastify API remains the authority for policy, approvals and
settlement, and every action is re-authorised server-side.

## Running it locally

From the repository root, with the backend up:

```bash
npm run infra:up            # PostgreSQL + Redis
npm run db:migrate          # apply migrations
npm run seed                # synthetic dataset
npm run dev:api             # API on 127.0.0.1:3100
npm run dev:worker          # queue worker

npm run web:install         # install the frontend dependencies (once)
npm run web:dev             # console on http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000>. The sign-in screen offers the three seeded roles
(analyst, approver, administrator) through the backend's local development token
endpoint.

### Backend configuration the console needs

| Setting | Required value | Why |
|---|---|---|
| `CORS_ORIGINS` | includes `http://localhost:3000` and `http://127.0.0.1:3000` | The browser calls the API directly, including the SSE stream. Without these origins the API rejects browser mutations (`403`) and the browser blocks the event stream. |
| `ENABLE_DEV_TOKENS` | `true` for local development | `POST /api/auth/dev-token` mints the session token the sign-in screen uses. |
| `NEXT_PUBLIC_API_BASE_URL` (frontend) | defaults to `http://127.0.0.1:3100` | Backend origin. See [.env.example](.env.example). |

`npm run web:dev` binds to `127.0.0.1:3000`, matching the recommended
`CORS_ORIGINS` entry.

## Routes

| Route | Purpose |
|---|---|
| `/login` | Role selection and session acquisition (FDD §7.10/§12) |
| `/overview` | Summary cards, recent runs, pending approvals, ledger activity, service status (FDD §7.1) |
| `/runs` | Searchable, filterable, paginated run list (FDD §7.3) |
| `/runs/new` | Submit a research request with an idempotency key (FDD §7.2) |
| `/runs/[id]` | Run summary, live workflow progress, findings, proposals, events, audit (FDD §7.4) |
| `/approvals` | Pending / approved / rejected / expired inbox (FDD §7.5) |
| `/approvals/[id]` | Proposal, evidence, policy decision and the decision panel (FDD §7.6) |
| `/refund-proposals` | Every proposal state, including policy-denied and expired (FDD §7.7) |
| `/refund-proposals/[id]` | Full proposal record with approval and settlement kept separate |
| `/ledger` | Simulated settlement operations, with direct lookup by operation id (FDD §7.8) |
| `/audit` | Chronological audit trail with filters (FDD §7.9) |
| `/settings` | Profile, session, permissions and display preferences (FDD §7.10) |

## Architecture

```text
src/
├── app/                    routes (App Router); (app)/ group holds the shell
├── components/ui/          primitives (button, card, badge, field, table, tabs, dialog, alert, skeleton)
├── components/layout/      shell: sidebar, topbar, page header, theme toggle, service indicator
├── components/data-display/ metric cards, status badges, timeline, evidence cards, empty/error states
├── components/feedback/    toaster
├── features/<domain>/      api.ts, hooks.ts (TanStack Query), rows.ts (pure joins), components/
├── lib/                    api-client, session-store, event-stream (SSE), schemas, formatters, status maps
└── types/                  API contracts
```

Server state is handled by TanStack Query; the SSE layer updates it. The pure
modules (`formatters`, `status`, `errors`, `sse`, `event-stream`, `rows`,
`aggregate`, `validation`) hold the logic that is worth testing without a browser,
and are covered by the unit suite.

### The decisions worth knowing

**Authenticated data access.** The token is kept in `sessionStorage`, not
`localStorage`: no cookie option exists on this API, and session scope is the
smaller exposure for a short-lived bearer token. The client never verifies the
signature — it reads the claims to render the identity and to stop sending an
expired token; the API verifies every request.

**The event stream is a hint, not the truth.** `EventSource` cannot send an
`Authorization` header, so the stream is a `fetch` with a hand-written SSE parser.
Events are de-duplicated by id, the last id is sent back as `Last-Event-ID` on
reconnect, and every batch of events also invalidates the run queries. A dropped
connection therefore degrades to polling, and is never presented as a run failure.

**Only the backend decides.** No screen marks a proposal authorised or settled.
An approval and a settlement are separate panels with separate statuses, and the
approval confirmation restates the exact supplier, amount, currency and proposal
id being authorised (FDD §12.4).

**Unknown state is a first-class case.** A status this build does not recognise
renders as "Unrecognised status" with its identifier preserved, rather than
disappearing or being coerced into a known one.

**Unavailable is not zero.** When a request fails, summary cards show
"Unavailable" beside an explicit error, because an unknown value and a zero mean
different things on a financial screen.

## Testing

```bash
npm run web:typecheck   # tsc --noEmit
npm run web:test        # vitest: 111 unit tests
npm run web:build       # production build
```

The unit suite covers what the FDD asks for as unit-testable (FDD §16): currency
and date formatting, status mapping including the unknown-status fallback, request
validation, API error normalisation, SSE framing and event de-duplication, and the
aggregate/row builders behind the list views.

Component and end-to-end tests (FDD §16) are **not** included in this build.

## Known limitations

- **List views are assembled from run history.** The API exposes approvals,
  proposals and settlements individually and per run, not as paginated collections,
  so the global views join the runs the caller can list. `GET /api/runs` is scoped
  to the caller's own runs, so an **approver** — who owns none — sees an empty
  inbox and an empty ledger, and reaches records by identifier instead. Each such
  view says so rather than showing a silent empty table.
- **Supplier names** appear only on an approval snapshot (`reviewed.supplierName`).
  Elsewhere the console shows the supplier identifier rather than inventing a name.
- **Settlement timestamps** come from `GET /api/ledger/operations/:id`, which the
  ledger page calls for the visible page only.
- **Owner names** are not exposed by the API; runs list the owner identifier.
- Settlement is simulated in every environment. No real funds move.
- Component and e2e tests are not implemented; the journeys were verified manually
  against a running backend (see the repository README).
