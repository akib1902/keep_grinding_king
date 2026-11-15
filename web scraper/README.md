# scraperStack

**Point-and-click web scraping for Chrome.** Pick an element on a page, tell scraperStack what to capture, run it across pages, and export clean CSV or JSON. Recipes are saved per site, datasets stay on your computer, and there is no build step, account, or server.

![Manifest V3](https://img.shields.io/badge/manifest-v3-8b5cf6) ![Chrome 116+](https://img.shields.io/badge/chrome-116%2B-22d3ee) ![No dependencies](https://img.shields.io/badge/dependencies-0-34d399)

---

## What it does

scraperStack is a complete Manifest V3 extension for turning web pages into structured data without writing a script.

- **Click to select.** A shadow-DOM overlay highlights elements, generates a stable CSS selector, and stays out of the page's way.
- **List mode or single record.** Capture every repeated card, row or result, or one record from a detail page.
- **Auto-detect.** Pick one card and scraperStack proposes the list container plus likely fields (title, price, image, link, date).
- **Relative fields.** Field selectors are resolved inside each item, so `.price` means "the price in this card", not "the first price on the page".
- **Nine capture types.** Text, link, image, any attribute, HTML, outer HTML, input value, match count and existence.
- **Transforms.** Trim and collapse whitespace, regex find/replace, prefix, suffix and a fallback value.
- **Pagination.** Click next, follow the next link in the background, click "load more", or auto-scroll an infinite feed.
- **Survives navigation.** If a next-page click reloads the tab, the run writes its state ahead, resumes on the new page, and keeps collecting.
- **Deduplication and caps.** Duplicate rows are dropped, with configurable row and page ceilings to protect the browser.
- **Datasets.** Every run is saved locally with its source URL, field list, page count and row count.
- **Exports.** CSV with Excel-friendly BOM + CRLF, JSON, and TSV copy for pasting straight into a spreadsheet.
- **Workspace.** A side panel for building, a dashboard for managing recipes and datasets, and a settings page for defaults and backups.
- **Local-first.** No telemetry, no analytics, no network calls of its own.

---

## Install

scraperStack runs as an unpacked extension. No packaging or build tools are required.

1. Download or clone this folder.
2. Open `chrome://extensions` in Chrome (or any Chromium browser with side panel support).
3. Turn on **Developer mode** (top right).
4. Choose **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Pin **scraperStack** from the extensions menu.
6. Click the toolbar icon to open the side panel. The first install also opens the dashboard.

**Requirements:** Chrome 116+ (`chrome.sidePanel`), Manifest V3. There is no Firefox build.

The suggested shortcut is `Ctrl+Shift+Y` (`⌘+Shift+Y` on macOS). Change it at `chrome://extensions/shortcuts`.

---

## First scrape

The fastest way to see the whole loop is the bundled demo shop.

```bash
node scripts/serve.mjs
# → http://localhost:4321/demo/
```

Open `http://localhost:4321/demo/shop.html`, then:

1. Click the scraperStack icon. The panel shows the page title and a **connected** badge.
2. Give the recipe a name, e.g. **Bookshop catalogue**.
3. With **Repeating list** selected, press the crosshair next to **Repeating item** and click any book card.
   - The panel fills in the container selector, a match count, and auto-detected fields.
4. Check the fields. Each one has a coverage badge; `100%` means it matched in every item.
5. Turn on **Pagination**, choose **Click the next control**, and press the crosshair next to **Next control**. Click the `Next →` link on the page.
6. Set **Max pages** to `3`.
7. Press **Scrape page**. The Run tab shows progress, rows, pages and a live preview.
8. Export CSV, export JSON, or copy TSV.

For a no-pagination control test, open `http://localhost:4321/demo/table.html` and use the item selector `#library-table tbody tr` with fields `td.title`, `td.author`, `td.year` and `td.status`.

### Without the demo

Any http(s) page works. On a real product grid:

1. Open the page and the side panel.
2. Pick one result card.
3. Press **Detect list** if the first pick is not the repeating group you expected.
4. Map fields, then run.

> Pages that cannot be scraped: `chrome://` pages, the Chrome Web Store, PDF viewer pages, and other extensions' pages. The panel shows **not scrapable** for those.

---

## The demo playground

| Page | What it tests | Item selector |
| --- | --- | --- |
| `demo/shop.html` | Three server pages, real `<a>` pagination, cards with images and links | `#catalogue > article.product-card` |
| `demo/table.html` | Plain HTML table with relative cell fields | `#library-table tbody tr` |
| `demo/loadmore.html` | Appended batches; the button disables when exhausted | `#load-more` (load-more strategy) |
| `demo/index.html` | Landing page with a step-by-step recipe walkthrough | — |

The shop's next control is a genuine link. On page 3 it is replaced by a disabled span, so the scraper has to stop on its own. That is intentional: it exercises both the "no next control" and "disabled control" exits.

---

## Concepts

### Recipes

A recipe is a saved scraping blueprint:

```json
{
  "name": "Bookshop catalogue",
  "mode": "list",
  "containerSelector": "#catalogue > article.product-card",
  "fields": [
    { "name": "Title", "selector": ".product-title", "kind": "text" },
    { "name": "Price", "selector": ".price", "kind": "text" },
    { "name": "Cover", "selector": "img.product-cover", "kind": "src" },
    { "name": "Detail URL", "selector": "a.product-link", "kind": "href" }
  ],
  "pagination": {
    "enabled": true,
    "mode": "url",
    "nextSelector": "a.next-page",
    "maxPages": 3
  },
  "dedupe": true
}
```

Recipes can be exported as JSON from the Library tab or the dashboard, and imported back. A backup file contains recipes, datasets and settings.

Drafts are saved automatically per origin, so closing the panel does not lose an unfinished recipe.

### Modes

| Mode | What it collects |
| --- | --- |
| **Repeating list** | One row per element matching the item selector. Field selectors are evaluated inside each item. |
| **Single record** | One row from the whole page. Field selectors are absolute page selectors. |

In list mode a field selector can use the special value `:self` to capture the whole item (its text, HTML, or a link inside it). The picker produces `:self` automatically if you click the item itself.

### Field types

| Kind | Reads |
| --- | --- |
| `text` | Visible text (`innerText`), with whitespace collapsed |
| `href` | `href`, resolved against the page URL |
| `src` | `src` or `data-src`, resolved against the page URL |
| `attribute` | Any named attribute (`data-sku`, `title`, `datetime`, …) |
| `html` | `innerHTML` |
| `outerHTML` | The element's own HTML |
| `value` | Form control value |
| `count` | Number of matches for the selector |
| `exists` | `true` / `false` |

**All** joins every match for a field with ` | `. **Transforms** can then trim, collapse, regex-replace, wrap with a prefix/suffix, or provide a fallback.

### Pagination strategies

| Strategy | Behaviour | Best for |
| --- | --- | --- |
| **Click the next control** | Clicks the next button/link, waits for the page's content to change, then collects again. If the tab navigates, the run resumes on the next page. | Classic "Next →" links and SPA pagination |
| **Follow the next link** | Fetches the next page's HTML in the background, parses it, and never navigates. | Server-rendered lists; fastest and safest |
| **Click "load more"** | Clicks the same control repeatedly until it disappears, disables, or stops adding rows. | Appended feeds |
| **Auto-scroll this page** | Scrolls to the bottom repeatedly to trigger lazy loading, then captures. | Infinite-scroll pages already rendered in the DOM |

Pagination limits: 1–50 pages, configurable wait and settle times, and an optional "stop when a page adds no new rows" guard.

**Resume** works like this: before clicking a control, the content script asks the service worker to persist the recipe, the rows collected so far and the next page number in `chrome.storage.session`. If the click unloads the tab, the fresh content script announces itself on the new page and the worker hands the state back. The run continues after the new page's items appear. Pending state expires after two minutes and is cleared when the tab closes.

`Follow the next link` only follows same-origin URLs. Cross-origin next links stop the run rather than silently scraping another site.

### Datasets and limits

Every completed run becomes a dataset:

- default cap of **5,000 rows per run**,
- default cap of **2,000 rows kept per dataset**,
- up to **40 datasets** and **250 recipes**,
- configurable from **Settings**.

Rows are stored as strings, in field order. Datasets keep their source URL, origin, mode, fields, page count, duration and a `truncated` flag. When the row cap is hit, the run stops and the dataset is marked truncated.

---

## The three surfaces

### Side panel — build and run

- **Build:** recipe picker, capture mode, item selector, field editor with transforms, pagination, run options.
- **Run:** live progress, rows/pages/elapsed, error messages, preview table, CSV/JSON/copy exports.
- **Library:** saved recipes with duplicate/export/delete, recent datasets with inline preview and export.
- **Picker:** crosshair buttons launch the on-page picker. A floating HUD explains what to click; `Esc` cancels.

The panel stays open while you click the page, which is why scraperStack uses a side panel instead of a popup.

### Dashboard

- Workspace stats: recipes, datasets, rows, latest run.
- Recent runs with preview and quick CSV.
- Recipe table with open-in-panel, edit JSON, duplicate, export and delete.
- Dataset cards with a three-row preview and full modal preview.
- Import/export backups, per-section filtering, storage usage.

### Settings

- Capture defaults: pages, delays, waits, row caps, dedupe, stop-on-empty-page, keep-empty-rows.
- Delete confirmation and first-run dashboard behaviour.
- Theme: auto / dark / light, shared by all surfaces.
- Backup, import, clear datasets, reset everything.
- Permission and privacy summary.

---

## Project structure

```
manifest.json                 Manifest V3 definition
background/
  service-worker.js           lifecycle, run state, datasets, menus, panel
content/
  content.js                  picker overlay, suggestions, scrape engine, resume
shared/
  constants.js                storage keys, defaults, message names
  selectors.js                selector generation, item generalisation, auto-detect
  extractor.js                recipe → rows
  ui.js                       page storage, exports, formatting, theme, backup
  theme.css                   shared design tokens and components
  icons.js                    inline SVG icon set
sidepanel/
  index.html · sidepanel.css · sidepanel.js
dashboard/
  index.html · dashboard.css · dashboard.js
options/
  index.html · options.css · options.js
demo/
  index.html · shop.html · table.html · loadmore.html
  demo.css · demo.js · cover.svg
icons/                        generated PNGs (16/32/48/128)
scripts/
  serve.mjs                   dependency-free static server for demos
  make-icons.mjs              dependency-free PNG icon generator
README.md
MILESTONES.md
```

There is no bundler, no `node_modules`, and no build output. Every script is a classic script loaded in order; the service worker uses `importScripts` for shared constants, and the content script gets its libraries from the manifest's `js` array.

### How a scrape flows

```
side panel ── RUN ──► content script
                        │  extract page 1
                        │  persist rows + next page (service worker → storage.session)
                        │  click next → tab navigates
                        ▼
                  new page's content script
                        │  CONTENT_READY
                        ▼
                  service worker returns pending run
                        │  extract page 2, merge, dedupe
                        ▼
                  SAVE_DATASET → chrome.storage.local
                        │
                        ▼
                  dashboard / side panel refresh
```

The extractor is shared: it runs on the live page and on `DOMParser` documents produced by the "follow link" strategy, resolving relative URLs against the fetched page.

---

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Recipes, drafts, datasets and settings, all local. |
| `scripting`, `activeTab` | Re-inject the picker after a page reload or when the extension was installed after the page loaded. |
| `sidePanel` | The builder must stay open while clicking the page. |
| `tabs` | Identify the active tab and open the dashboard. |
| `contextMenus` | "Scrape this page" / "Pick an element" in the right-click menu. |
| Host access to `http://*/*`, `https://*/*` | Read the page you are explicitly scraping, and follow same-origin next links. |

scraperStack does **not** request access to `file://` URLs or chrome pages, and does not run on pages you have not opened the panel on.

### Privacy

- All data stays in `chrome.storage.local` on this machine.
- No analytics, crash reporting, accounts, or remote configuration.
- The only network requests are to the same site being scraped, made when you choose **Follow the next link**.

---

## Development

No build step. After editing a file:

1. Go to `chrome://extensions`.
2. Press **Reload** on scraperStack.
3. Reload the target page if you changed the content script.

Useful commands:

```bash
# Demo server (127.0.0.1:4321)
node scripts/serve.mjs
node scripts/serve.mjs 4322        # alternate port

# Regenerate the PNG icons after editing scripts/make-icons.mjs
node scripts/make-icons.mjs

# Parse-check every script
for f in $(find . -name '*.js' -not -path './node_modules/*'); do node --check "$f" || exit 1; done
```

The dashboard, side panel and options page can be opened directly from the demo server for layout work:

- `http://localhost:4321/sidepanel/index.html?demo=1`
- `http://localhost:4321/dashboard/index.html?demo=1`
- `http://localhost:4321/options/index.html`

Outside the extension they use a `localStorage` fallback and show a **Preview mode** banner; picker and run actions are disabled. `?demo=1` seeds sample recipes and datasets for visual review.

### Verification

What has been checked in this build:

- Every JavaScript file parses; the manifest and all manifest-referenced files exist.
- The selector engine, auto-detect and extractor were exercised against the three demo pages in Chromium: unique selectors, repeated-item generalisation, relative field coverage, auto-mapped rows, and background fetching of page 2 parsed with `DOMParser`.
- The side panel, dashboard and options page boot in preview mode without console errors.

What still needs a manual Chrome pass (the extension runtime cannot be loaded by a static page):

- [ ] Load unpacked, pin, open the panel on the demo shop.
- [ ] Pick a card, confirm auto-detected fields and coverage badges.
- [ ] Run a single page, then a three-page run with **Click next**.
- [ ] Confirm the run resumes after a full navigation and reaches 18 unique rows.
- [ ] Run **Follow the next link** and compare the rows to the click run.
- [ ] Test **Load more** on `demo/loadmore.html` (6 → 12 rows).
- [ ] Stop a run mid-pagination; confirm partial rows are saved.
- [ ] Export CSV, JSON and TSV; open the CSV in a spreadsheet.
- [ ] Confirm datasets and recipes survive a browser restart.
- [ ] Import a backup in Settings and verify nothing is duplicated.
- [ ] Check the panel at its narrowest docked width.
- [ ] Confirm chrome:// pages show "not scrapable".

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Badge says **reload page** | The page was open before the extension was installed or reloaded. Refresh the tab. |
| Picker never appears | The page is not http(s) (chrome://, Web Store, PDF), or the panel is not connected. Reload the page and reopen the panel. |
| "No items matched" | The item selector does not match the current DOM. Press **Detect list** or re-pick an item; use **Test** to preview without saving. |
| Fields are empty | Relative selectors may be wrong for some items. Check the coverage badge; pick the field again inside a card rather than on the whole page. |
| Pagination stops after one page | The next control vanished, became disabled, or the content did not change within the wait window. Increase **Wait for change**, or switch to **Follow the next link**. |
| A run resumes on the wrong page | Resume is keyed by tab, origin and a two-minute TTL. Start the run again from page 1. |
| Export is empty | The dataset is still saving, or every row was empty. Check the row cap in Settings. |
| Side panel will not open | Chrome below 116 does not support the side panel API. Use the dashboard instead, or update Chrome. |
| Data vanished | Uninstalling an extension deletes its `chrome.storage.local` data. Export a backup first. |

---

## Known limitations

- **Top frame only.** Content inside iframes is not scraped.
- **Closed shadow DOM and canvas** content cannot be read with CSS selectors.
- **Element-level picking.** Pseudo-elements and text-node ranges are not selectable.
- **Same-origin pagination.** Background link following refuses cross-origin URLs.
- **Single-tab resume.** Long runs need the tab to stay open; state expires after two minutes of navigation.
- **Chrome/Chromium only.** Built on `chrome.sidePanel`; no Firefox port yet.
- **No scheduling or headless runs.** The browser must be open.
- **Heuristic detection.** Auto-detect is a starting point, not a guarantee on deeply nested or virtualised lists.
- **Fixed field shape.** Values are strings; nested JSON/array fields are not modelled yet.

---

## Roadmap

The milestone plan, including completed phases and what comes next, lives in [MILESTONES.md](MILESTONES.md).

Near-term candidates: shadow-DOM/iframe support, XPath and JSON-LD extraction, scheduled runs, per-site variables, a Playwright end-to-end suite, and richer column mapping.

---

*v1.0.0 — built as a complete, dependency-free reproduction of a point-and-click web scraper.*
