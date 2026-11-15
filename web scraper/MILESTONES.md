# scraperStack — milestones

A milestone is a shippable slice of the extension. Each has sub-milestones that can be checked independently. Status reflects this repository, not aspiration.

**Legend:** `[x]` built and checked · `[~]` built, still needs a manual Chrome pass · `[ ]` planned

---

## M0 · Foundations

The skeleton every other milestone stands on: a valid MV3 extension, a content script that loads on the right pages, local storage, and shared design primitives.

- [x] Manifest V3 with explicit minimum Chrome version (116)
- [x] Service worker with install/startup lifecycle and a single message router
- [x] Content script registered for `http://*/*` and `https://*/*`
- [x] Side panel registered and configured to open on toolbar click
- [x] Context menus: "Scrape this page" and "Pick an element"
- [x] Keyboard command (`Ctrl/⌘+Shift+Y`)
- [x] Storage keys, defaults, caps and message names in one shared module
- [x] Generated PNG icons (16/32/48/128) with a dependency-free generator
- [x] Shared design tokens and components (`shared/theme.css`)
- [x] Shared page utilities: storage, export, formatting, theme, backup
- [x] Chart-free, dependency-free build: no bundler, no `node_modules`

**Exit criteria:** the extension loads unpacked, the panel opens, and the content script answers a ping.

---

## M1 · Selector engine and on-page picker

The part that makes the tool feel like magic: hover, pick, and get a selector that still works after a refresh.

- [x] Stable-ID detection (rejects generated, numeric and hash-like IDs)
- [x] Attribute-first matching (`data-testid`, `itemprop`, `aria-label`, `name`, …)
- [x] Class-based matching with hashed/state/utility class filtering
- [x] `:nth-of-type` path fallback with uniqueness validation
- [x] Anchor shortening against a stable ancestor
- [x] Repeating-item generalisation (`itemSelectorFor`) with match counting
- [x] Relative field selectors scored across every list item, with coverage
- [x] `:self` for capturing the item itself
- [x] Container auto-detection ranked by repetition, text, links and images
- [x] Field auto-detection (image, link, title, price, date, text)
- [x] Shadow-DOM overlay: highlight box, selector tooltip, instructions HUD
- [x] Crosshair cursor, escape-to-cancel, cancel button
- [x] Scroll/resize repositioning while picking
- [x] Match flash after a container pick
- [x] Toasts for picks, run start and completion
- [x] No picker UI leaks into the page's styles

**Exit criteria:** picking any card produces a selector that matches that card, and picking a field produces a relative selector with 100% coverage on the demo list.

---

## M2 · Recipe builder

The side panel becomes a real editor: recipes, fields, transforms, drafts and validation.

- [x] List mode and single-record mode
- [x] Recipe picker, new recipe, rename, save, duplicate, delete
- [x] Recipe JSON import/export (single and all)
- [x] Field list with add, remove, reorder-by-order, rename
- [x] Nine capture kinds (text, href, src, attribute, HTML, outer HTML, value, count, exists)
- [x] Per-field attribute name input
- [x] "All" mode to join every match
- [x] Transforms: trim, collapse whitespace, regex find/replace, flags, prefix, suffix, fallback
- [x] Per-field coverage badge after a pick
- [x] Auto-detect fields replaces empty fields, appends missing ones
- [x] List suggestions from "Detect list"
- [x] Per-origin drafts, debounced and restored on reopen
- [x] Client-side selector validation before a run
- [x] Friendly validation messages that route back to the Build tab

**Exit criteria:** a recipe can be built, saved, reloaded, duplicated, exported, imported and deleted without losing fields or transforms.

---

## M3 · Extraction and pagination

Turning recipes into rows, including pages that fight back.

- [x] Extraction engine shared between live documents and parsed HTML
- [x] Text, attribute, href, src, HTML, value, count and exists readers
- [x] URL resolution against the source document
- [x] Whitespace normalisation and the full transform pipeline
- [x] Row signature and cross-page deduplication
- [x] Run caps: rows, pages, 50-page hard ceiling
- [x] Empty-row filtering with an opt-in to keep them
- [x] Pagination strategy: **click** next control
- [x] Pagination strategy: **follow next link** (background fetch + `DOMParser`)
- [x] Pagination strategy: **load more**
- [x] Pagination strategy: **auto-scroll**
- [x] Wait for content, wait for change, settle delay
- [x] Disabled-control detection (attribute, class, `disabled`)
- [x] Same-origin guard for followed links
- [x] Write-ahead run state persisted in `chrome.storage.session`
- [x] Resume after navigation via `CONTENT_READY`
- [x] Pending-state TTL and cleanup on tab close
- [x] Stop button that keeps partial results
- [x] Progress messages: page, rows, phase, preview
- [x] Error messages surfaced in the Run tab and on the page toast

**Exit criteria:** three demo pages collected as 18 unique rows with either click or follow-link strategy.

---

## M4 · Datasets and export

Collected data has to be inspectable, portable and safe to keep.

- [x] Automatic dataset save in the service worker
- [x] Row trimming to the configured per-dataset cap
- [x] Dataset metadata: source, origin, mode, fields, pages, duration, truncation
- [x] Dataset list limited to 40, recipes to 250
- [x] CSV export with BOM, CRLF and correct quoting
- [x] JSON export with metadata
- [x] TSV clipboard copy for spreadsheets
- [x] Dataset previews (side panel and dashboard)
- [x] Dataset deletion, clear-all
- [x] Storage usage reporting
- [x] Full workspace backup and non-destructive import

**Exit criteria:** a run's rows can be exported as CSV/JSON and re-imported from a backup without duplicates.

---

## M5 · Workspace surfaces

Three surfaces with distinct jobs, sharing one design system.

- [x] Side panel tabs: Build, Run, Library
- [x] Sticky run actions, field cards, suggestions panel
- [x] Dashboard overview with stats and recent runs
- [x] Dashboard recipe manager (open in panel, JSON edit, duplicate, export, delete)
- [x] Dashboard dataset browser with modal preview
- [x] Dashboard filters and backup tools
- [x] Options: capture defaults, appearance, data, permissions, about
- [x] Theme switching (auto/dark/light) across all surfaces
- [x] "Open recipe in panel" request queue + live message
- [x] Responsive layout for narrow side panels and mobile-width dashboard
- [x] Empty states with direct CTAs
- [x] Preview-mode fallback for designing pages outside the extension

**Exit criteria:** every workflow can be reached from the toolbar, context menu or dashboard without dead ends.

---

## M6 · Demo, documentation and QA

- [x] Paper & Pine demo storefront: paginated shop, library table, load-more feed
- [x] Demo landing page with a six-step recipe walkthrough
- [x] Zero-dependency static server (`scripts/serve.mjs`)
- [x] Zero-dependency icon pipeline (`scripts/make-icons.mjs`)
- [x] README: install, first scrape, concepts, architecture, permissions, privacy
- [x] README: troubleshooting and known limitations
- [x] Milestone plan (this file)
- [x] Parse-check every JavaScript file
- [x] Engine tests in Chromium against all three demo pages
- [x] UI boot check for panel, dashboard and options in preview mode
- [~] Manual end-to-end pass on an installed copy (checklist in README)
- [~] Cross-page resume verified manually
- [~] CSV opened in a real spreadsheet

**Exit criteria:** a new user can install, run the demo recipe and export data using only the README.

---

## M7 · Hardening (next)

Things that make it dependable on messier real-world pages.

- [ ] Shadow-DOM traversal for open shadow roots
- [ ] Same-origin iframe scraping
- [ ] XPath as an alternative selector language
- [ ] JSON-LD / embedded state extraction
- [ ] Virtualised list support (capture on scroll)
- [ ] Retry with backoff for transient navigation failures
- [ ] Configurable per-site rate limiting
- [ ] Column mapping and renamed export headers
- [ ] Dataset merge / append mode
- [ ] Playwright suite covering pick → run → export
- [ ] Crash-safe dataset spooling for very long runs

---

## M8 · Reach (later)

- [ ] Scheduled scrapes via `chrome.alarms` (panel-independent)
- [ ] Cross-device recipe sync (opt-in, user-owned storage)
- [ ] Firefox port (sidebar + `browser.*` shim)
- [ ] Recipe variables and template URLs
- [ ] Screenshot-per-row capture
- [ ] Diffing runs to track price/content changes

---

## Completed in v1.0.0

| Area | Files |
| --- | --- |
| Picker + run engine | `content/content.js`, `shared/selectors.js`, `shared/extractor.js` |
| Lifecycle + data | `background/service-worker.js`, `shared/constants.js` |
| Builder | `sidepanel/*` |
| Workspace | `dashboard/*`, `options/*` |
| Design system | `shared/theme.css`, `shared/icons.js`, `shared/ui.js` |
| Fixtures | `demo/*` |
| Tooling | `scripts/serve.mjs`, `scripts/make-icons.mjs` |
| Docs | `README.md`, `MILESTONES.md` |
