# Frontend Design Document (FDD)

## 1. Document Information

| Field | Description |
|---|---|
| Product | LedgerFlow |
| System | Resilient Multi-Step Financial Research & Settlement Agent |
| Document | Frontend Design Document |
| Version | 1.0 |
| Status | Proposed |
| Frontend framework | Next.js, React and TypeScript |
| Styling | Tailwind CSS and shadcn/ui |
| Backend | Fastify REST API and SSE |
| Primary users | Finance analysts, finance approvers and administrators |

## 2. Purpose

This document defines the user interface, navigation, page layouts, interaction patterns, API integration, frontend state management and accessibility requirements for the LedgerFlow web application.

The frontend provides a visual interface for interacting with the asynchronous financial research backend. It enables users to submit research requests, monitor execution, review financial evidence, authorize eligible refund proposals, and inspect simulated settlement records.

The frontend shall communicate with the existing backend rather than implementing financial business rules independently.

## 3. Product Goals

### 3.1 Primary Goals

1. Make asynchronous AI workflows understandable and observable.
2. Present financial research findings with traceable evidence.
3. Make approval requirements explicit and easy to review.
4. Prevent misleading UI states that imply unauthorized or incomplete settlements succeeded.
5. Provide a clear audit trail for important workflow events.
6. Demonstrate a polished, production-oriented user experience.

### 3.2 Non-Goals

The MVP frontend will not:

- Initiate real bank transfers.
- Store financial authorization logic exclusively in the browser.
- Allow users to modify the AI's tool permissions.
- Execute model calls directly from the browser.
- Replace backend authentication, authorization or policy validation.
- Provide full accounting software functionality.
- Require a complex analytics platform or extensive administrative configuration.

## 4. User Personas

### 4.1 Finance Analyst

Needs to create financial research tasks, monitor their progress, inspect anomalies and prepare refund proposals.

Primary actions:
- Submit a research request.
- View run progress.
- Inspect transactions and anomaly evidence.
- Review refund proposals.
- Retrieve completed reports.

### 4.2 Finance Approver

Needs to review the evidence and decide whether a specific refund proposal should proceed.

Primary actions:
- View pending approval requests.
- Inspect the supplier, amount, currency and supporting transaction.
- Review the policy decision and proposal history.
- Approve or reject a proposal.
- Confirm the final decision and its recorded status.

### 4.3 Administrator / Operator

Needs to inspect system health, workflow failures and execution history.

Primary actions:
- Inspect run failures and retry status.
- Review execution steps and error codes.
- Inspect audit history.
- View operational metrics and queue health, where exposed by the backend.

The UI shall show actions only when appropriate, but backend authorization remains mandatory even when an action is hidden or disabled.

## 5. Information Architecture

The application shall use a persistent sidebar on desktop and a collapsible navigation drawer on smaller screens.

### Primary navigation

1. **Overview** — Operational summary and recent activity.
2. **Research Runs** — Run list, submission and execution details.
3. **Approvals** — Pending, approved, rejected and expired proposals.
4. **Refund Proposals** — Proposal details and evidence.
5. **Settlement Ledger** — Simulated settlement history.
6. **Audit Trail** — Chronological execution and decision records.
7. **Settings** — Profile and permitted preferences.

Administrative operations may be included in Settings or a restricted administration section, depending on the backend's authorization model.

## 6. Global Application Layout

### 6.1 Desktop Layout

The desktop shell shall contain:

- A persistent left sidebar.
- A top navigation bar with page title and user menu.
- A main content region.
- A contextual action area when needed.
- Toast notifications for transient feedback.
- A consistent breadcrumb pattern for nested detail pages.

The primary content region shall use a responsive grid with a maximum readable width on report-oriented pages. Dense tables may use the available horizontal space.

### 6.2 Responsive Layout

On tablets, the sidebar may collapse to icons or a drawer.

On mobile devices:
- Tables shall provide responsive column prioritization or controlled horizontal scrolling.
- Important financial amounts and statuses shall remain visible.
- Approval details shall stack vertically.
- Critical decisions shall not depend on hover interactions.
- The SSE connection indicator shall remain accessible without dominating the screen.

### 6.3 Application Shell

The application shell shall remain consistent across all pages, including loading, empty, error and disconnected states.

## 7. Page Specifications

### 7.1 Overview Dashboard

**Route:** `/overview`

Purpose: Provide a concise summary of current research activity and outstanding decisions.

#### Components

- Page heading and current date.
- Primary action: New research run.
- Summary cards:
  - Active runs.
  - Runs requiring approval.
  - Completed runs.
  - Failed runs.
- Recent research runs table.
- Pending approvals list.
- Recent settlement activity.
- Service or event-stream status, when supported by backend telemetry.

#### Behavior

Summary values shall be derived from authenticated API responses.

The frontend shall not invent transaction totals or settlement amounts when data is unavailable.

A failed request shall display an explicit unavailable state rather than silently presenting zero as the actual value.

#### Acceptance Criteria

- Users can navigate from a summary card to the relevant filtered list.
- Recent runs link to their detail pages.
- Pending approval items link to the relevant proposal.
- Empty datasets display a useful first-action prompt.

### 7.2 New Research Run

**Route:** `/runs/new`

Purpose: Allow an analyst to submit a high-level research request.

#### Form Fields

- Task description.
- Analysis period start date.
- Analysis period end date.
- Currency selection.
- Optional analysis parameters supported by the API.

Example task:

"Analyze Q3 spending anomalies, identify potential supplier overcharges, and prepare refund proposals supported by transaction evidence."

#### Behavior

1. Validate required fields and date ranges.
2. Submit the request to `POST /api/runs`.
3. Send an idempotency key for the logical submission.
4. Disable duplicate submission while the request is in flight.
5. On acceptance, navigate to the run detail page.
6. Show the assigned run ID and current status.

If the HTTP request times out and the outcome is uncertain, the client shall not blindly create another logical run with a new idempotency key. It should recover the original submission outcome where supported.

#### Acceptance Criteria

- Invalid dates and missing required fields are rejected before submission.
- API validation errors appear next to relevant fields where possible.
- Successful submission opens the corresponding run.
- Network errors do not falsely indicate that the run has started.

### 7.3 Research Runs List

**Route:** `/runs`

Purpose: Provide searchable access to historical and active runs.

#### Table Columns

- Run ID.
- Request summary.
- Created time.
- Owner.
- Current status.
- Execution duration.
- Approval state, where applicable.
- Actions.

#### Features

- Filter by status.
- Search by run identifier or request text.
- Sort by creation time.
- Pagination.
- Link to run details.
- Refresh and loading indicators.

Filters and pagination shall be driven by supported backend query parameters or implemented against bounded result sets.

### 7.4 Research Run Detail

**Route:** `/runs/[id]`

This is the primary demonstration page.

#### Page Sections

**A. Run summary**
- Run ID.
- Request summary.
- Created and updated timestamps.
- Current status.
- Execution attempt count.
- Token usage and tool-call count, if available.

**B. Workflow progress**
- Ordered sequence of completed, active, pending and failed steps.
- Tool names and execution duration.
- Approval pause indicator.
- Retry information.
- Final outcome.

**C. Research findings**
- Anomaly title and description.
- Severity or priority, if defined by the backend.
- Supporting transaction references.
- Observed values and relevant comparisons.
- Distinction between measured evidence and AI-generated interpretation.

**D. Refund proposals**
- Supplier.
- Proposed amount and currency.
- Source transaction.
- Policy result.
- Approval status.
- Link to proposal details.

**E. Execution history**
- Event timeline.
- Tool execution summaries.
- Failure codes and safe error messages.
- Approval and settlement events.

#### Live Updates

The frontend shall connect to the SSE endpoint while the run is active.

New events shall update the UI without requiring a full page reload. The frontend shall reconnect when the connection is interrupted and use the last event ID when supported.

The frontend shall also periodically or conditionally refetch authoritative run state after reconnecting or receiving important state-transition events.

#### Acceptance Criteria

- The user can observe execution progress.
- A paused run clearly displays the reason and required next action.
- A failed step is distinguishable from an active or successful step.
- The page remains correct after refresh or reconnection.
- Duplicate events do not duplicate timeline entries.
- A final result is not displayed as successful until confirmed by the backend.

### 7.5 Approvals Inbox

**Route:** `/approvals`

Purpose: Help authorized reviewers manage outstanding approval requests.

#### Views

- Pending.
- Approved.
- Rejected.
- Expired.

#### Table Columns

- Approval ID.
- Run ID.
- Supplier.
- Proposed amount.
- Currency.
- Request timestamp.
- Expiry.
- Current decision status.

#### Behavior

The page shall retrieve approval data from the backend, apply supported filters and link to individual approval details.

The frontend shall not infer approval status solely from the run status.

#### Acceptance Criteria

- Pending approvals are easy to distinguish.
- Expired and completed requests are not presented as actionable.
- Unauthorized users cannot successfully decide a proposal even if they manually invoke the endpoint.

### 7.6 Approval Detail

**Route:** `/approvals/[id]`

Purpose: Enable an authorized reviewer to make an informed decision.

#### Layout

**Proposal summary**
- Supplier identity.
- Amount and currency.
- Original transaction.
- Proposed refund justification.
- Proposal version.
- Current approval status.

**Evidence panel**
- Source transaction details.
- Relevant anomaly findings.
- Supporting record references.
- Applicable policy decision.

**Decision panel**
- Approve action.
- Reject action.
- Optional rejection reason, if supported by the API.
- Confirmation dialog showing the exact proposal details.
- Expiry and stale-proposal warnings.

#### Approval Interaction

Before sending a decision, the interface shall display the supplier, amount and currency that the reviewer is authorizing.

After confirmation:
1. Submit the decision to the backend.
2. Display the request's processing state.
3. Refetch the approval and run status.
4. Show the recorded outcome.
5. Explain whether the run is resuming, remains paused or has reached a terminal state.

Approval and settlement shall be presented as separate events. An approval response must not be displayed as a completed settlement.

### 7.7 Refund Proposal Detail

**Route:** `/refund-proposals/[id]`

Purpose: Present the full proposal record independently of the approval inbox.

#### Sections

- Proposal overview.
- Supplier and transaction details.
- Proposed refund amount and currency.
- Supporting evidence.
- Policy decision and policy version.
- Approval history.
- Associated run and steps.
- Settlement status, if applicable.

The interface shall distinguish among:
- Proposed.
- Awaiting approval.
- Approved.
- Rejected.
- Expired.
- Settled.
- Failed or cancelled, where applicable.

The exact status mapping shall follow the backend's documented domain states.

### 7.8 Settlement Ledger

**Route:** `/ledger`

Purpose: Display simulated settlement operations.

#### Table Columns

- Operation ID.
- Supplier.
- Amount.
- Currency.
- Settlement timestamp.
- Source proposal.
- Associated run.
- Status.

#### Behavior

- Search by operation ID.
- Filter by status and date.
- Open settlement details.
- Navigate to the associated proposal and run.
- Clearly label the ledger as simulated.

The frontend shall not display a pending proposal as a completed ledger entry.

### 7.9 Audit Trail

**Route:** `/audit`

Purpose: Present an auditable history of workflow and financial decisions.

#### Event Categories

- Run created.
- Run started.
- Step started or completed.
- Tool failure.
- Policy decision.
- Approval requested.
- Approval approved or rejected.
- Settlement completed.
- Run failed or cancelled.

#### Filters

- Run ID.
- Event type.
- Date range.
- Actor, where available.
- Operation ID.

Each entry shall include a timestamp, event identifier, relevant actor or system component, safe summary and link to the associated resource.

The frontend shall not imply that a UI-rendered timeline itself provides tamper-proof audit storage. Audit integrity is a backend responsibility.

### 7.10 Settings

**Route:** `/settings`

The MVP settings page may provide:
- User profile information.
- Session information.
- Display preferences.
- Accessible theme selection, if implemented.

Financial policy thresholds and security-sensitive settings shall not be changed through a generic user preference interface. If administrative configuration is added later, it must use dedicated authorized backend operations.

## 8. Visual Design System

### 8.1 Design Direction

The visual language shall be professional, restrained and information-dense.

The interface should resemble a financial operations console rather than a consumer chatbot.

### 8.2 Color System

Recommended default theme: light interface with dark navy navigation and neutral content surfaces.

| Token | Purpose |
|---|---|
| Background | Neutral light gray |
| Surface | White cards and panels |
| Primary | Dark navy or deep blue |
| Secondary | Slate gray |
| Success | Green status and completion indicators |
| Warning | Amber approval and attention indicators |
| Danger | Red for denied, failed or destructive states |
| Border | Low-contrast neutral gray |
| Focus | High-contrast visible focus ring |

Color shall never be the only way to communicate a status. Every status badge must include a readable label and, where useful, an icon.

### 8.3 Typography

- Use a readable sans-serif family for interface text.
- Use tabular numerals for monetary values, IDs and metrics.
- Use a monospace font for technical identifiers, error codes and event IDs where appropriate.
- Maintain clear heading hierarchy and comfortable line lengths.

### 8.4 Spacing and Layout

Use a consistent spacing scale based on four-pixel increments.

- Cards: consistent internal padding.
- Tables: compact but readable rows.
- Forms: clear field labels and validation messages.
- Detail pages: separate research evidence from financial decisions.
- Approval pages: visually prioritize the amount, supplier and decision status.

### 8.5 Component Library

Use reusable components for:
- Application shell.
- Sidebar and breadcrumbs.
- Page headers.
- Metric cards.
- Status badges.
- Data tables.
- Timeline events.
- Approval decision panels.
- Evidence cards.
- Currency and date formatting.
- Empty, loading and error states.
- Confirmation dialogs.
- Toast notifications.

## 9. Frontend Architecture

The frontend shall use feature-oriented modules and shared design components.

Suggested structure:

```text
src/
├── app/
│   ├── (app)/
│   │   ├── overview/
│   │   ├── runs/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   └── [id]/
│   │   ├── approvals/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   ├── refund-proposals/
│   │   │   └── [id]/
│   │   ├── ledger/
│   │   ├── audit/
│   │   └── settings/
│   ├── login/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/
│   ├── layout/
│   ├── data-display/
│   └── feedback/
├── features/
│   ├── runs/
│   ├── approvals/
│   ├── proposals/
│   ├── ledger/
│   └── audit/
├── lib/
│   ├── api-client.ts
│   ├── auth.ts
│   ├── query-client.ts
│   ├── event-stream.ts
│   ├── formatters.ts
│   └── schemas/
├── hooks/
├── types/
└── tests/
```

The exact route grouping may change depending on authentication and layout requirements.

### 9.1 Server and Client Components

Use React Server Components for suitable initial page rendering and static layout work.

Use Client Components for interactive tables, forms, dialogs, live progress, filters and SSE connections.

All browser-side interactive components shall consume backend APIs through a shared typed API client.

### 9.2 API Client

The API client shall centralize:
- Base URL configuration.
- Authentication credentials or access tokens.
- Request IDs and correlation headers where supported.
- Response parsing and runtime validation.
- Error normalization.
- Safe retry behavior.
- Consistent handling of unauthorized and expired sessions.

Mutating requests shall not be retried automatically unless the request's idempotency behavior is understood and correctly implemented.

## 10. Frontend State Management

### 10.1 Server State

Use TanStack Query for:
- Run details.
- Run lists.
- Approval lists.
- Proposal details.
- Ledger records.
- Audit records.
- Cache invalidation after mutations.

### 10.2 Local UI State

Use React state or a small local state abstraction for:
- Open dialogs.
- Table selections.
- Expanded timeline steps.
- Form fields.
- Temporary filters not represented in the URL.

### 10.3 Live Event State

The SSE layer shall:
- Maintain one appropriately scoped connection per active run view.
- Deduplicate events by event ID.
- Track the last received event ID.
- Handle reconnects and connection errors.
- Update relevant query caches or trigger refetches.
- Close the connection when the associated view no longer needs it.

The event stream shall not be treated as the sole authoritative source of run state.

## 11. API Integration Contracts

The frontend shall integrate with these backend endpoints:

| Endpoint | Frontend use |
|---|---|
| `POST /api/runs` | Submit a research request |
| `GET /api/runs/:id` | Display run status and result |
| `GET /api/runs/:id/steps` | Render execution history |
| `GET /api/runs/:id/events` | Retrieve event history |
| `GET /api/tasks/:id/stream` | Stream live progress |
| `POST /api/runs/:id/cancel` | Request cancellation |
| `GET /api/approvals/:id` | Load approval details |
| `POST /api/approvals/:id/decision` | Submit a decision |
| `GET /api/refund-proposals/:id` | Display proposal evidence |
| `GET /api/ledger/operations/:id` | Display settlement status |

The frontend shall use the actual OpenAPI schemas produced by the backend as the source of truth for request and response types.

If the backend exposes paginated list endpoints or summary endpoints, the frontend shall use them rather than downloading unrestricted datasets.

## 12. Authentication and Security

### 12.1 Session Handling

The application shall use the backend's documented authentication mechanism.

If cookie-based sessions are selected, use appropriate secure cookie settings and CSRF protection for state-changing requests.

If bearer tokens are selected, avoid storing long-lived credentials in browser local storage when a safer architecture is available.

### 12.2 Authorization

- The backend shall authorize every protected action.
- The frontend shall display actions according to the authenticated user's permissions when those permissions are available.
- Hiding a button shall not be considered access control.
- The application shall handle `401`, `403` and expired-session responses explicitly.

### 12.3 Sensitive Data

- Do not expose LLM provider credentials to the browser.
- Do not place approval secrets in analytics, logs or URLs that may leak through referrer headers.
- Redact sensitive values from client-side logs.
- Do not render untrusted model output as executable HTML.
- Validate any rich text before rendering.
- Use confirmation dialogs for financial decisions.

### 12.4 Financial Decision Confirmation

Before approval, show the exact supplier, amount, currency and proposal identifier.

The approval decision shall be sent to the backend, which must revalidate permissions, proposal state and approval requirements.

The UI shall never independently mark a proposal as authorized or settled.

## 13. Loading, Empty, Error and Recovery States

Every data-driven page shall define four states:

1. Loading.
2. Successful data.
3. Empty data.
4. Error or unavailable data.

The run detail page additionally requires:
- Connecting to event stream.
- Live execution.
- Event stream disconnected.
- Reconnecting.
- Approval required.
- Execution failed.
- Execution completed.
- Cancellation pending.

If the SSE connection fails, the page shall retain the last known data and attempt recovery. It shall not convert a connection failure into a run failure.

If the API returns an unknown state, the frontend shall display a safe fallback status and preserve the underlying identifier for diagnostics.

## 14. Accessibility

The frontend shall target WCAG 2.2 Level AA where applicable.

Requirements:
- Full keyboard navigation.
- Visible focus indicators.
- Proper labels and descriptions for inputs.
- Accessible dialog focus management.
- Screen-reader-friendly status updates.
- Sufficient text and interface contrast.
- Non-color-only status communication.
- Reduced-motion support.
- Accessible table headers and responsive behavior.
- Confirmation dialogs that clearly identify the action and financial amount.

Live event announcements shall be concise. The interface should not announce every low-level tool event in a way that overwhelms assistive technology users.

## 15. Performance

- Use pagination for large tables.
- Avoid unnecessary rerenders during SSE updates.
- Lazy-load nonessential charts and heavy detail components.
- Keep the initial route payload reasonable.
- Reuse cached query results where safe.
- Avoid aggressive polling when SSE is available.
- Respect user navigation and close unused streams.
- Measure Core Web Vitals and bundle size before claiming performance improvements.

## 16. Frontend Testing

### Unit Tests

- Currency and date formatting.
- Status badge mapping.
- Request validation.
- API error normalization.
- Event deduplication.
- State presentation for known run states.

### Component Tests

- Research request form.
- Run status timeline.
- Anomaly evidence panel.
- Approval confirmation dialog.
- Empty and error states.
- Responsive data table.

### End-to-End Tests

1. Submit a new research run.
2. Observe progress and completed findings.
3. Open a proposal requiring approval.
4. Approve the proposal using an authorized test account.
5. Verify the run's updated status.
6. Verify the simulated settlement in the ledger.
7. Verify that a rejected proposal does not settle.
8. Simulate SSE disconnection and reconnection.
9. Verify that an unauthorized user cannot complete a decision.

The end-to-end tests shall use a controlled test backend or isolated integration environment and synthetic financial data.

## 17. Definition of Done

The frontend MVP is complete when:

- All primary routes are implemented.
- The user can submit and inspect a run.
- Research progress updates through SSE.
- Findings include supporting evidence.
- Approval requests display the correct proposal details.
- Authorized approval and rejection workflows work end to end.
- The settlement ledger displays only backend-confirmed operations.
- Refresh and reconnect behavior preserve the correct application state.
- Loading, empty and error states are implemented.
- Authentication and authorization behavior is tested.
- Responsive and keyboard-accessible interactions are verified.
- Automated tests pass.
- The application can be run locally using documented instructions.

## 18. Future Enhancements

Potential later improvements include:
- Interactive transaction and anomaly exploration.
- More detailed operational telemetry.
- Configurable saved research queries.
- Approval delegation and escalation.
- Exportable research reports.
- Additional anomaly visualization.
- An operator interface for recovery and reconciliation.
- A separate design system package if multiple applications are introduced.
