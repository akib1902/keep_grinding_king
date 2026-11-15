/* scraperStack · service worker
 * Owns lifecycle, run state (for pagination resume), datasets, context menus
 * and the side panel.
 */
importScripts('../shared/constants.js');

const C = self.SSConst;
const MSG = C.MSG;
const KEYS = C.KEYS;

const RUN_TTL_MS = 120000;

/* --------------------------------------------------------------- lifecycle */

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  buildContextMenus();
  await ensureSettings();

  if (details.reason === 'install') {
    const settings = await getSettings();
    if (settings.openDashboardOnInstall) {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html?welcome=1') });
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  buildContextMenus();
});

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ss-open-scraper',
      title: 'Scrape this page with scraperStack',
      contexts: ['page', 'selection', 'link', 'image']
    });
    chrome.contextMenus.create({
      id: 'ss-pick-element',
      title: 'Pick an element with scraperStack',
      contexts: ['all']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    /* Open the dashboard as a fallback when the panel cannot open. */
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    return;
  }
  if (info.menuItemId === 'ss-pick-element') {
    await sleep(400);
    sendToTab(tab.id, {
      type: MSG.PICK,
      payload: { kind: 'field', fieldId: '' }
    }, { inject: true });
  }
});

chrome.action.onClicked.addListener(() => {
  /* A default_popup is not defined; setPanelBehavior opens the side panel.
   * This listener is a fallback for platforms where the panel cannot open. */
});

/* ------------------------------------------------------------------ helpers */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(KEYS.settings);
  if (!stored[KEYS.settings]) {
    await chrome.storage.local.set({ [KEYS.settings]: C.DEFAULTS });
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(KEYS.settings);
  return Object.assign({}, C.DEFAULTS, stored[KEYS.settings] || {});
}

async function sendToTab(tabId, message, options = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!options.inject) return null;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'shared/constants.js',
          'shared/selectors.js',
          'shared/extractor.js',
          'content/content.js'
        ]
      });
      await sleep(120);
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectErr) {
      return null;
    }
  }
}

function isScrapable(url) {
  return /^https?:/i.test(url || '');
}

function runStorageKey(tabId) {
  return KEYS.runPrefix + tabId;
}

async function clearRunState(tabId, runId) {
  const key = runStorageKey(tabId);
  if (!runId) {
    await chrome.storage.session.remove(key);
    return;
  }
  const stored = await chrome.storage.session.get(key);
  const run = stored[key];
  if (run && (!run.runId || run.runId === runId)) {
    await chrome.storage.session.remove(key);
  }
}

/* ----------------------------------------------------------------- datasets */

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function saveDataset(payload) {
  const settings = await getSettings();
  const cap = Math.max(100, Math.min(Number(settings.maxStoredRows) || 2000, 20000));
  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, cap) : [];
  const dataset = {
    id: payload.datasetId || uid('ds'),
    runId: payload.runId || '',
    recipeId: payload.recipeId || '',
    recipeName: payload.recipeName || 'Untitled scrape',
    url: payload.url || '',
    origin: payload.origin || '',
    mode: payload.mode || 'list',
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    rows,
    rowCount: Number(payload.rowCount) || rows.length,
    pages: Number(payload.pages) || 1,
    durationMs: Number(payload.durationMs) || 0,
    truncated: !!payload.truncated || rows.length < (payload.rowCount || rows.length),
    createdAt: payload.createdAt || Date.now()
  };

  const stored = await chrome.storage.local.get(KEYS.datasets);
  const list = Array.isArray(stored[KEYS.datasets]) ? stored[KEYS.datasets] : [];
  list.unshift(dataset);
  const trimmed = list.slice(0, C.LIMITS.maxDatasets);
  await chrome.storage.local.set({ [KEYS.datasets]: trimmed });

  broadcast({ type: MSG.DATA_CHANGED, payload: { scope: 'datasets' } });
  return dataset;
}

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (err) {
    /* no listeners */
  }
}

/* ----------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message || {};
  const payload = msg.payload || {};
  const tabId = (sender.tab && sender.tab.id) || payload.tabId || null;

  switch (msg.type) {
    case MSG.CONTENT_READY: {
      (async () => {
        if (!tabId) return sendResponse({ ok: false });
        const key = runStorageKey(tabId);
        const stored = await chrome.storage.session.get(key);
        const run = stored[key];
        if (!run) return sendResponse({ ok: true, run: null });
        if (run.expiresAt && Date.now() > run.expiresAt) {
          await chrome.storage.session.remove(key);
          return sendResponse({ ok: true, run: null });
        }
        if (run.origin && payload.url && !payload.url.startsWith(run.origin)) {
          return sendResponse({ ok: true, run: null });
        }
        run.expiresAt = Date.now() + RUN_TTL_MS;
        await chrome.storage.session.set({ [key]: run });
        sendResponse({ ok: true, run });
      })();
      return true;
    }

    case MSG.SET_RUN_STATE: {
      (async () => {
        if (!tabId) return sendResponse({ ok: false });
        const key = runStorageKey(tabId);
        const stored = await chrome.storage.session.get(key);
        const previous = stored[key] || {};
        const state = Object.assign({}, previous, payload, {
          tabId,
          updatedAt: Date.now(),
          expiresAt: payload.expiresAt || Date.now() + RUN_TTL_MS
        });
        await chrome.storage.session.set({ [key]: state });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.CLEAR_RUN_STATE: {
      (async () => {
        if (tabId) await clearRunState(tabId, payload.runId);
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.GET_RUN_STATE: {
      (async () => {
        if (!tabId) return sendResponse({ ok: true, run: null });
        const key = runStorageKey(tabId);
        const stored = await chrome.storage.session.get(key);
        const run = stored[key];
        if (!run || (run.expiresAt && Date.now() > run.expiresAt)) {
          await chrome.storage.session.remove(key);
          return sendResponse({ ok: true, run: null });
        }
        sendResponse({ ok: true, run });
      })();
      return true;
    }

    case MSG.SAVE_DATASET: {
      (async () => {
        try {
          const dataset = await saveDataset(payload);
          await clearRunState(tabId, payload.runId);
          broadcast({ type: MSG.RUN_DONE, payload: dataset });
          sendResponse({ ok: true, datasetId: dataset.id });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    case MSG.GET_CONTEXT: {
      (async () => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tab = tabs[0] || null;
        sendResponse({
          ok: true,
          tab: tab ? { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId } : null,
          scrapable: !!(tab && isScrapable(tab.url))
        });
      })();
      return true;
    }

    case MSG.OPEN_DASHBOARD: {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
      sendResponse({ ok: true });
      return false;
    }

    case MSG.OPEN_PANEL: {
      (async () => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tab = tabs[0];
        if (!tab) return sendResponse({ ok: false });
        try {
          await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    default:
      return false;
  }
});

/* Tab lifecycle: drop pending state when its tab goes away. */
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(runStorageKey(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  if (!isScrapable(tab.url)) {
    chrome.storage.session.remove(runStorageKey(tabId)).catch(() => {});
  }
});
