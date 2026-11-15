/* scraperStack · shared page utilities
 * Storage access for every extension page. Falls back to localStorage when a
 * page is opened outside the extension (handy for design review with ?demo=1).
 */
(function (root) {
  'use strict';

  var C = root.SSConst || {};
  var KEYS = C.KEYS || {
    recipes: 'ss.recipes',
    datasets: 'ss.datasets',
    settings: 'ss.settings',
    draftPrefix: 'ss.draft.',
    runPrefix: 'ss.run.'
  };
  var DEFAULTS = C.DEFAULTS || {};
  var LIMITS = C.LIMITS || { maxRecipes: 250, maxDatasets: 40 };
  var IS_EXT = !!(root.chrome && chrome.runtime && chrome.runtime.id);
  var DEV_PREFIX = 'scraperstack.dev.';

  /* ------------------------------------------------------------- storage io */

  function devGet(keys) {
    var out = {};
    keys.forEach(function (key) {
      var raw = localStorage.getItem(DEV_PREFIX + key);
      if (raw != null) {
        try {
          out[key] = JSON.parse(raw);
        } catch (err) {
          out[key] = null;
        }
      }
    });
    return out;
  }

  function normalizeKeys(keys) {
    if (keys == null) return [];
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
  }

  async function storageGet(keys) {
    var list = normalizeKeys(keys);
    if (IS_EXT) return chrome.storage.local.get(list);
    return devGet(list);
  }

  async function storageSet(obj) {
    if (IS_EXT) return chrome.storage.local.set(obj);
    Object.keys(obj).forEach(function (key) {
      localStorage.setItem(DEV_PREFIX + key, JSON.stringify(obj[key]));
    });
  }

  async function storageRemove(keys) {
    var list = normalizeKeys(keys);
    if (IS_EXT) return chrome.storage.local.remove(list);
    list.forEach(function (key) {
      localStorage.removeItem(DEV_PREFIX + key);
    });
  }

  /* --------------------------------------------------------------- settings */

  async function getSettings() {
    var data = await storageGet(KEYS.settings);
    return Object.assign({}, DEFAULTS, data[KEYS.settings] || {});
  }

  async function saveSettings(patch) {
    var current = await getSettings();
    var next = Object.assign({}, current, patch || {});
    await storageSet({ [KEYS.settings]: next });
    return next;
  }

  /* ----------------------------------------------------------------- recipes */

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeRecipe(input, previous) {
    var now = Date.now();
    var base = previous || {};
    var recipe = Object.assign({}, base, input || {});
    recipe.id = recipe.id || uid('rcp');
    recipe.name = String(recipe.name || 'Untitled recipe').trim().slice(0, 80) || 'Untitled recipe';
    recipe.mode = recipe.mode === 'single' ? 'single' : 'list';
    recipe.containerSelector = String(recipe.containerSelector || '');
    recipe.fields = (Array.isArray(recipe.fields) ? recipe.fields : []).slice(0, LIMITS.maxFields || 40).map(function (field, index) {
      return {
        id: field.id || 'fld_' + index + '_' + Math.random().toString(36).slice(2, 6),
        name: String(field.name || 'Field ' + (index + 1)).slice(0, 60),
        selector: String(field.selector || '').slice(0, 400),
        kind: field.kind || 'text',
        attribute: String(field.attribute || ''),
        multiple: !!field.multiple,
        joinWith: field.joinWith || ' | ',
        transform: Object.assign(
          { trim: true, collapse: true, regex: '', flags: 'g', replace: '', prefix: '', suffix: '', fallback: '' },
          field.transform || {}
        )
      };
    });
    recipe.pagination = Object.assign({
      enabled: false,
      mode: 'click',
      nextSelector: '',
      maxPages: 5,
      waitMs: 4000,
      settleMs: 260,
      stopWhenNoNew: true
    }, recipe.pagination || {});
    recipe.scroll = Object.assign({ enabled: false, steps: 6, delayMs: 650 }, recipe.scroll || {});
    recipe.dedupe = recipe.dedupe !== false;
    recipe.createdAt = base.createdAt || recipe.createdAt || now;
    recipe.updatedAt = now;
    return recipe;
  }

  async function getRecipes() {
    var data = await storageGet(KEYS.recipes);
    var list = data[KEYS.recipes];
    return Array.isArray(list) ? list : [];
  }

  async function getRecipe(id) {
    var list = await getRecipes();
    return list.find(function (recipe) {
      return recipe.id === id;
    }) || null;
  }

  async function saveRecipe(input) {
    var list = await getRecipes();
    var index = list.findIndex(function (recipe) {
      return recipe.id === input.id;
    });
    var recipe = normalizeRecipe(input, index >= 0 ? list[index] : null);
    if (index >= 0) list[index] = recipe;
    else list.unshift(recipe);
    await storageSet({ [KEYS.recipes]: list.slice(0, LIMITS.maxRecipes || 250) });
    return recipe;
  }

  async function deleteRecipe(id) {
    var list = await getRecipes();
    var next = list.filter(function (recipe) {
      return recipe.id !== id;
    });
    await storageSet({ [KEYS.recipes]: next });
  }

  async function duplicateRecipe(id) {
    var recipe = await getRecipe(id);
    if (!recipe) return null;
    var copy = JSON.parse(JSON.stringify(recipe));
    copy.id = '';
    copy.name = recipe.name + ' copy';
    copy.createdAt = 0;
    return saveRecipe(copy);
  }

  /* ---------------------------------------------------------------- datasets */

  async function getDatasets() {
    var data = await storageGet(KEYS.datasets);
    var list = data[KEYS.datasets];
    return Array.isArray(list) ? list : [];
  }

  async function getDataset(id) {
    var list = await getDatasets();
    return list.find(function (dataset) {
      return dataset.id === id;
    }) || null;
  }

  async function deleteDataset(id) {
    var list = await getDatasets();
    await storageSet({
      [KEYS.datasets]: list.filter(function (dataset) {
        return dataset.id !== id;
      })
    });
  }

  async function clearDatasets() {
    await storageSet({ [KEYS.datasets]: [] });
  }

  /* ------------------------------------------------------------------ drafts */

  async function getDraft(origin) {
    if (!origin) return null;
    var key = KEYS.draftPrefix + origin;
    var data = await storageGet(key);
    return data[key] || null;
  }

  async function saveDraft(origin, recipe) {
    if (!origin) return;
    var key = KEYS.draftPrefix + origin;
    await storageSet({ [key]: Object.assign({}, recipe, { savedAt: Date.now() }) });
  }

  async function clearDraft(origin) {
    if (!origin) return;
    await storageRemove(KEYS.draftPrefix + origin);
  }

  /* ----------------------------------------------------------------- helpers */

  async function storageUsage() {
    if (IS_EXT && chrome.storage.local.getBytesInUse) {
      try {
        return await chrome.storage.local.getBytesInUse(null);
      } catch (err) {
        return 0;
      }
    }
    var total = 0;
    Object.keys(localStorage).forEach(function (key) {
      if (key.indexOf(DEV_PREFIX) !== 0) return;
      total += (localStorage.getItem(key) || '').length;
    });
    return total;
  }

  async function exportAll() {
    var recipes = await getRecipes();
    var datasets = await getDatasets();
    var settings = await getSettings();
    return {
      app: 'scraperStack',
      kind: 'backup',
      version: (C && C.VERSION) || '1.0.0',
      exportedAt: new Date().toISOString(),
      recipes: recipes,
      datasets: datasets,
      settings: settings
    };
  }

  async function importAll(backup) {
    if (!backup || typeof backup !== 'object') throw new Error('Not a scraperStack backup file.');
    var imported = 0;
    if (Array.isArray(backup.recipes)) {
      var existing = await getRecipes();
      var ids = new Set(existing.map(function (recipe) { return recipe.id; }));
      backup.recipes.forEach(function (recipe) {
        if (!recipe || !recipe.name || !Array.isArray(recipe.fields)) return;
        if (recipe.id && ids.has(recipe.id)) return;
        var normalized = normalizeRecipe(recipe, null);
        ids.add(normalized.id);
        existing.unshift(normalized);
        imported += 1;
      });
      await storageSet({ [KEYS.recipes]: existing.slice(0, LIMITS.maxRecipes || 250) });
    }
    if (Array.isArray(backup.datasets) && backup.datasets.length) {
      var datasets = await getDatasets();
      var datasetIds = new Set(datasets.map(function (d) { return d.id; }));
      var added = backup.datasets.filter(function (dataset) {
        return dataset && dataset.id && !datasetIds.has(dataset.id) && Array.isArray(dataset.rows);
      });
      await storageSet({ [KEYS.datasets]: added.concat(datasets).slice(0, LIMITS.maxDatasets || 40) });
      imported += added.length;
    }
    if (backup.settings && typeof backup.settings === 'object') {
      var current = await getSettings();
      await saveSettings(Object.assign({}, current, backup.settings));
    }
    return imported;
  }

  /* ------------------------------------------------------------------- seed */

  async function seedDemo() {
    if (IS_EXT) return;
    var recipes = await getRecipes();
    if (recipes.length) return;
    var now = Date.now();
    var demoRecipes = [
      normalizeRecipe({
        id: 'rcp_demo_shop',
        name: 'Bookshop catalogue',
        mode: 'list',
        containerSelector: '#catalogue > article.product-card',
        fields: [
          { id: 'f1', name: 'Title', selector: 'h3.product-title', kind: 'text' },
          { id: 'f2', name: 'Author', selector: '.product-author', kind: 'text' },
          { id: 'f3', name: 'Price', selector: '.price', kind: 'text' },
          { id: 'f4', name: 'Rating', selector: '.rating', kind: 'text' },
          { id: 'f5', name: 'Detail URL', selector: 'a.product-link', kind: 'href' },
          { id: 'f6', name: 'Cover', selector: 'img.product-cover', kind: 'src' }
        ],
        pagination: { enabled: true, mode: 'click', nextSelector: 'a.next-page', maxPages: 3 },
        origin: 'http://localhost:4321',
        url: 'http://localhost:4321/demo/shop.html'
      }, null),
      normalizeRecipe({
        id: 'rcp_demo_table',
        name: 'Library table',
        mode: 'list',
        containerSelector: '#library-table tbody tr',
        fields: [
          { id: 'f1', name: 'Title', selector: 'td.title', kind: 'text' },
          { id: 'f2', name: 'Author', selector: 'td.author', kind: 'text' },
          { id: 'f3', name: 'Year', selector: 'td.year', kind: 'text' },
          { id: 'f4', name: 'Status', selector: 'td.status', kind: 'text' }
        ]
      }, null)
    ];
    var demoRows = [
      { Title: "The Cartographer's Daughter", Author: 'Ines Marlowe', Price: '$18.00', Rating: '4.6', 'Detail URL': 'https://example.com/books/1', Cover: 'https://example.com/covers/1.svg' },
      { Title: 'Salt & Signal', Author: 'Rafael Okonkwo', Price: '$22.50', Rating: '4.9', 'Detail URL': 'https://example.com/books/2', Cover: 'https://example.com/covers/2.svg' },
      { Title: 'A Field Guide to Quiet Machines', Author: 'Hana Petrova', Price: '$16.00', Rating: '4.2', 'Detail URL': 'https://example.com/books/3', Cover: 'https://example.com/covers/3.svg' },
      { Title: 'The Last Lighthouse Keeper', Author: 'Elias Ward', Price: '$19.99', Rating: '4.7', 'Detail URL': 'https://example.com/books/4', Cover: 'https://example.com/covers/4.svg' },
      { Title: 'Paper Cities', Author: 'June Adair', Price: '$14.25', Rating: '4.1', 'Detail URL': 'https://example.com/books/5', Cover: 'https://example.com/covers/5.svg' },
      { Title: 'Northbound', Author: 'Kwame Mensah', Price: '$21.00', Rating: '4.8', 'Detail URL': 'https://example.com/books/6', Cover: 'https://example.com/covers/6.svg' }
    ];
    var demoDatasets = [
      {
        id: 'ds_demo_shop',
        runId: 'run_demo_shop',
        recipeId: 'rcp_demo_shop',
        recipeName: 'Bookshop catalogue',
        url: 'http://localhost:4321/demo/shop.html',
        origin: 'http://localhost:4321',
        mode: 'list',
        fields: ['Title', 'Author', 'Price', 'Rating', 'Detail URL', 'Cover'],
        rows: demoRows,
        rowCount: demoRows.length,
        pages: 1,
        durationMs: 2140,
        truncated: false,
        createdAt: now - 1000 * 60 * 42
      },
      {
        id: 'ds_demo_table',
        runId: 'run_demo_table',
        recipeId: 'rcp_demo_table',
        recipeName: 'Library table',
        url: 'http://localhost:4321/demo/table.html',
        origin: 'http://localhost:4321',
        mode: 'list',
        fields: ['Title', 'Author', 'Year', 'Status'],
        rows: [
          { Title: 'Dune', Author: 'Frank Herbert', Year: '1965', Status: 'Available' },
          { Title: 'The Dispossessed', Author: 'Ursula K. Le Guin', Year: '1974', Status: 'Checked out' },
          { Title: 'Piranesi', Author: 'Susanna Clarke', Year: '2020', Status: 'Available' },
          { Title: 'Roadside Picnic', Author: 'Arkady Strugatsky', Year: '1972', Status: 'Available' }
        ],
        rowCount: 4,
        pages: 1,
        durationMs: 980,
        truncated: false,
        createdAt: now - 1000 * 60 * 60 * 26
      }
    ];
    await storageSet({
      [KEYS.recipes]: demoRecipes,
      [KEYS.datasets]: demoDatasets
    });
  }

  function onChanged(callback) {
    if (!IS_EXT || !chrome.storage.onChanged) return function () {};
    var handler = function (changes, area) {
      if (area === 'local') callback(changes);
    };
    chrome.storage.onChanged.addListener(handler);
    return function () {
      chrome.storage.onChanged.removeListener(handler);
    };
  }

  /* -------------------------------------------------------------------- csv */

  function csvCell(value) {
    var s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function columnsFor(rows, preferred) {
    var cols = Array.isArray(preferred) ? preferred.slice() : [];
    rows.forEach(function (row) {
      Object.keys(row || {}).forEach(function (key) {
        if (cols.indexOf(key) === -1) cols.push(key);
      });
    });
    return cols;
  }

  function toCSV(rows, preferredColumns) {
    var columns = columnsFor(rows, preferredColumns);
    if (!columns.length) return '';
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (row) {
      lines.push(columns.map(function (column) {
        return csvCell(row ? row[column] : '');
      }).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function toJSON(rows, meta) {
    return JSON.stringify(Object.assign({ exportedAt: new Date().toISOString() }, meta || {}, { rows: rows }), null, 2);
  }

  function safeFilename(name) {
    var base = String(name || 'scraperstack')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 70)
      .replace(/^-|-$/g, '');
    return base || 'scraperstack';
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (copyErr) {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  /* ---------------------------------------------------------------- format */

  function formatNumber(value) {
    var n = Number(value) || 0;
    try {
      return new Intl.NumberFormat().format(n);
    } catch (err) {
      return String(n);
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
      date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(value) {
    var ts = typeof value === 'number' ? value : new Date(value).getTime();
    if (!ts || isNaN(ts)) return '—';
    var diff = Math.max(0, Date.now() - ts);
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    if (days < 30) return days + 'd ago';
    return formatDate(ts);
  }

  function formatDuration(ms) {
    var value = Number(ms) || 0;
    if (value < 1000) return value + ' ms';
    if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + ' s';
    return Math.floor(value / 60000) + 'm ' + Math.round((value % 60000) / 1000) + 's';
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch (err) {
      return url || '';
    }
  }

  function debounce(fn, wait) {
    var timer = 0;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  }

  /* ------------------------------------------------------------------ theme */

  var media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: light)') : null;

  function applyTheme(theme) {
    var resolved = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : (media && media.matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', resolved);
    return resolved;
  }

  async function initTheme() {
    var settings = await getSettings();
    applyTheme(settings.theme);
    if (media && media.addEventListener) {
      media.addEventListener('change', function () {
        getSettings().then(function (s) {
          if (!s.theme || s.theme === 'auto') applyTheme('auto');
        });
      });
    }
    return settings;
  }

  /* ---------------------------------------------------------------- panel */

  async function takeRequestedRecipe() {
    var key = 'ss.requestedRecipe';
    var data = await storageGet(key);
    var id = data[key] || '';
    if (id) await storageRemove(key);
    return id;
  }

  async function resetAll() {
    if (IS_EXT) {
      var all = await chrome.storage.local.get(null);
      var keys = Object.keys(all).filter(function (key) {
        return key === KEYS.recipes || key === KEYS.datasets || key === KEYS.settings ||
          key === 'ss.requestedRecipe' || key.indexOf(KEYS.draftPrefix) === 0 || key.indexOf(KEYS.runPrefix) === 0;
      });
      if (keys.length) await chrome.storage.local.remove(keys);
      await storageSet({ [KEYS.settings]: Object.assign({}, DEFAULTS) });
      return;
    }
    Object.keys(localStorage).forEach(function (key) {
      if (key.indexOf(DEV_PREFIX) === 0) localStorage.removeItem(key);
    });
  }

  async function openPanel() {
    if (!IS_EXT) return false;
    try {
      var win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      return true;
    } catch (err) {
      return false;
    }
  }

  async function openRecipeInPanel(id) {
    if (!IS_EXT) return false;
    await storageSet({ 'ss.requestedRecipe': id });
    try {
      chrome.runtime.sendMessage({ type: 'ss/load-recipe', payload: { id: id } }).catch(function () {});
    } catch (err) {
      /* the panel will read the request when it opens */
    }
    return openPanel();
  }

  async function openDashboard(query) {
    if (IS_EXT) {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html' + (query || '')) });
      return;
    }
    root.open('../dashboard/index.html' + (query || ''), '_blank');
  }

  function isValidCss(selector) {
    if (!selector || selector === ':self') return true;
    try {
      document.createDocumentFragment().querySelector(selector);
      return true;
    } catch (err) {
      return false;
    }
  }

  root.SS = root.SS || {};
  root.SS.store = {
    isExtension: IS_EXT,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getRecipes: getRecipes,
    getRecipe: getRecipe,
    saveRecipe: saveRecipe,
    deleteRecipe: deleteRecipe,
    duplicateRecipe: duplicateRecipe,
    getDatasets: getDatasets,
    getDataset: getDataset,
    deleteDataset: deleteDataset,
    clearDatasets: clearDatasets,
    getDraft: getDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    storageUsage: storageUsage,
    exportAll: exportAll,
    importAll: importAll,
    takeRequestedRecipe: takeRequestedRecipe,
    resetAll: resetAll,
    seedDemo: seedDemo,
    onChanged: onChanged
  };
  root.SS.exporters = {
    toCSV: toCSV,
    toJSON: toJSON,
    columnsFor: columnsFor,
    downloadText: downloadText,
    copyText: copyText,
    safeFilename: safeFilename
  };
  root.SS.fmt = {
    number: formatNumber,
    date: formatDate,
    timeAgo: timeAgo,
    duration: formatDuration,
    bytes: formatBytes,
    host: hostOf
  };
  root.SS.dom = {
    escape: escapeHtml
  };
  root.SS.util = {
    uid: uid,
    debounce: debounce,
    normalizeRecipe: normalizeRecipe,
    isValidCss: isValidCss,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  };
  root.SS.theme = {
    apply: applyTheme,
    init: initTheme
  };
  root.SS.panel = {
    open: openPanel,
    openRecipe: openRecipeInPanel,
    openDashboard: openDashboard
  };
})(window);
