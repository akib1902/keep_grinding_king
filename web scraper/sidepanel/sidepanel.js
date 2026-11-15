/* scraperStack · side panel controller */
(function () {
  'use strict';

  var C = window.SSConst;
  var MSG = C.MSG;
  var SS = window.SS;
  var icon = function (name, size) { return SS.icons.get(name, size || 14); };
  var esc = function (value) { return SS.dom.escape(value); };
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var FIELD_KINDS = [
    ['text', 'Text'],
    ['href', 'Link (href)'],
    ['src', 'Image (src)'],
    ['attribute', 'Attribute'],
    ['html', 'HTML'],
    ['outerHTML', 'Outer HTML'],
    ['value', 'Input value'],
    ['count', 'Match count'],
    ['exists', 'Exists']
  ];

  var INPUT_MAP = {
    paginationEnabled: { path: 'pagination.enabled', type: 'bool', after: 'pagination' },
    paginationMode: { path: 'pagination.mode', type: 'string', after: 'pagination' },
    nextSelector: { path: 'pagination.nextSelector', type: 'string', after: 'pagination' },
    maxPages: { path: 'pagination.maxPages', type: 'number', min: 1, max: 50 },
    pageDelay: { path: 'pagination.delayMs', type: 'number', min: 0, max: 8000 },
    pageWait: { path: 'pagination.waitMs', type: 'number', min: 500, max: 15000 },
    pageSettle: { path: 'pagination.settleMs', type: 'number', min: 0, max: 4000 },
    stopWhenNoNew: { path: 'pagination.stopWhenNoNew', type: 'bool' },
    dedupe: { path: 'dedupe', type: 'bool' },
    preScroll: { path: 'scroll.enabled', type: 'bool', after: 'options' },
    scrollSteps: { path: 'scroll.steps', type: 'number', min: 1, max: 50 },
    scrollDelay: { path: 'scroll.delayMs', type: 'number', min: 150, max: 5000 }
  };

  var state = {
    context: { tabId: null, url: '', title: '', origin: '', scrapable: false },
    settings: {},
    recipes: [],
    datasets: [],
    recipe: null,
    savedId: null,
    tab: 'build',
    picking: null,
    run: null,
    runTimer: 0,
    containerCount: null,
    advanced: new Set(),
    status: 'connecting',
    dirty: false,
    ready: false
  };

  var scheduleDraft = SS.util.debounce(function () {
    if (!state.recipe || !state.context.origin) return;
    SS.store.saveDraft(state.context.origin, state.recipe).catch(function () {});
  }, 500);

  var scheduleCount = SS.util.debounce(function () {
    refreshContainerCount();
  }, 650);

  /* ------------------------------------------------------------------ boot */

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    hydrateIcons();
    await SS.theme.init();
    state.settings = await SS.store.getSettings();

    if (!SS.store.isExtension) {
      $('#devBanner').hidden = false;
      if (new URLSearchParams(location.search).get('demo') === '1') {
        await SS.store.seedDemo();
      }
      state.context = {
        tabId: null,
        url: 'http://localhost:4321/demo/shop.html',
        title: 'Paper & Pine — Bookshop',
        origin: 'http://localhost:4321',
        scrapable: false
      };
      state.status = 'dev';
    }

    await Promise.all([loadRecipes(), loadDatasets()]);
    if (SS.store.isExtension) await resolveContext();
    bindEvents();
    await initRecipe();

    if (SS.store.isExtension && state.context.scrapable) {
      await pingContent();
      await refreshContainerCount();
    }

    state.ready = true;
    renderAll();
    await restorePendingRun();
  }

  function hydrateIcons() {
    $$('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.getAttribute('data-icon'), 14);
    });
  }

  async function resolveContext() {
    try {
      var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      var tab = tabs[0];
      if (!tab || !tab.id) {
        state.status = 'none';
        return;
      }
      var url = tab.url || '';
      var scrapable = /^https?:/i.test(url);
      state.context = {
        tabId: tab.id,
        url: url,
        title: tab.title || '',
        origin: originOf(url),
        scrapable: scrapable
      };
      state.status = scrapable ? 'connecting' : 'unsupported';
    } catch (err) {
      state.status = 'none';
    }
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (err) {
      return '';
    }
  }

  async function pingContent() {
    var res = await sendToTab({ type: MSG.PING });
    if (res && res.ok) {
      state.status = 'ready';
      if (res.title) state.context.title = res.title;
      if (res.url) state.context.url = res.url;
    } else {
      state.status = state.context.scrapable ? 'no-content' : 'unsupported';
    }
  }

  async function injectContent() {
    if (!SS.store.isExtension || !state.context.tabId || !state.context.scrapable) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.context.tabId },
        files: [
          'shared/constants.js',
          'shared/selectors.js',
          'shared/extractor.js',
          'content/content.js'
        ]
      });
      await SS.util.sleep(140);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function sendToTab(message) {
    if (!SS.store.isExtension || !state.context.tabId) return null;
    try {
      return await chrome.tabs.sendMessage(state.context.tabId, message);
    } catch (err) {
      var injected = await injectContent();
      if (!injected) return null;
      try {
        return await chrome.tabs.sendMessage(state.context.tabId, message);
      } catch (sendErr) {
        return null;
      }
    }
  }

  /* ------------------------------------------------------------------ data */

  async function loadRecipes() {
    state.recipes = await SS.store.getRecipes();
  }

  async function loadDatasets() {
    state.datasets = await SS.store.getDatasets();
  }

  function blankField(name) {
    return {
      id: SS.util.uid('fld'),
      name: name || '',
      selector: '',
      kind: 'text',
      attribute: '',
      multiple: false,
      joinWith: ' | ',
      transform: { trim: true, collapse: true, regex: '', flags: 'g', replace: '', prefix: '', suffix: '', fallback: '' }
    };
  }

  function blankRecipe(origin) {
    return {
      id: '',
      name: '',
      mode: 'list',
      containerSelector: '',
      fields: [blankField('Title')],
      pagination: {
        enabled: false,
        mode: 'click',
        nextSelector: '',
        maxPages: state.settings.maxPages || 5,
        delayMs: state.settings.pageDelayMs || 1000,
        waitMs: 4000,
        settleMs: 260,
        stopWhenNoNew: true
      },
      scroll: { enabled: false, steps: 6, delayMs: 650 },
      dedupe: true,
      origin: origin || '',
      url: state.context.url || ''
    };
  }

  async function initRecipe() {
    var params = new URLSearchParams(location.search);
    var wanted = params.get('recipe');
    var recipe = null;

    if (wanted) {
      var found = state.recipes.find(function (item) { return item.id === wanted; });
      if (found) recipe = JSON.parse(JSON.stringify(found));
    }
    if (!recipe) {
      var requested = await SS.store.takeRequestedRecipe();
      if (requested) {
        var requestedRecipe = state.recipes.find(function (item) { return item.id === requested; });
        if (requestedRecipe) recipe = JSON.parse(JSON.stringify(requestedRecipe));
      }
    }
    if (!recipe && state.context.origin) {
      var draft = await SS.store.getDraft(state.context.origin);
      if (draft) recipe = draft;
    }
    if (!recipe) recipe = blankRecipe(state.context.origin);

    state.recipe = SS.util.normalizeRecipe(recipe, null);
    state.savedId = state.recipes.some(function (item) { return item.id === state.recipe.id; })
      ? state.recipe.id
      : null;
  }

  function currentRecipe() {
    return state.recipe;
  }

  function markDirty() {
    state.dirty = true;
    scheduleDraft();
  }

  function setPath(target, path, value) {
    var parts = path.split('.');
    var node = target;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  /* ------------------------------------------------------------------- pick */

  async function startPick(kind, fieldId) {
    if (!SS.store.isExtension) {
      toast('Load the extension to pick elements on a page.', 'warn');
      return;
    }
    if (!state.context.scrapable) {
      toast('Open a regular web page first.', 'warn');
      return;
    }
    if (state.picking) await sendToTab({ type: MSG.CANCEL_PICK });
    var res = await sendToTab({
      type: MSG.PICK,
      payload: {
        kind: kind,
        fieldId: fieldId || '',
        container: state.recipe.containerSelector,
        mode: state.recipe.mode
      }
    });
    if (!res || !res.ok) {
      toast('Could not start the picker. Reload the page and try again.', 'warn');
      return;
    }
    state.picking = { kind: kind, fieldId: fieldId || '' };
    state.status = 'picking';
    renderContext();
    toast(kind === 'container' ? 'Click one item of the repeating list.' :
      kind === 'next' ? 'Click the next-page control.' : 'Click the field on the page.');
  }

  function clearPicking() {
    state.picking = null;
    if (state.status === 'picking') state.status = 'ready';
    renderContext();
  }

  function applyPick(payload) {
    clearPicking();
    var recipe = state.recipe;

    if (payload.kind === 'container') {
      recipe.mode = 'list';
      recipe.containerSelector = payload.selector;
      state.containerCount = payload.count;
      if (payload.fields && payload.fields.length) {
        var usable = recipe.fields.filter(function (field) { return field.selector; });
        if (!usable.length) {
          recipe.fields = payload.fields.map(toField);
        } else {
          recipe.fields = mergeFields(recipe.fields, payload.fields);
        }
      }
      renderRecipeMeta();
      renderFields();
      updatePaginationUi();
      updateOptionsUi();
      markDirty();
      toast('Found ' + payload.count + ' items' + (payload.fields && payload.fields.length ? ' and ' + payload.fields.length + ' fields' : '') + '.');
      return;
    }

    if (payload.kind === 'next') {
      recipe.pagination.nextSelector = payload.selector;
      recipe.pagination.enabled = true;
      $('#nextSelector').value = payload.selector;
      $('#paginationEnabled').checked = true;
      updatePaginationUi();
      markDirty();
      toast('Next control saved.');
      return;
    }

    var field = recipe.fields.find(function (item) { return item.id === payload.fieldId; });
    if (!field) {
      field = blankField(payload.suggestedName || 'Field');
      recipe.fields.push(field);
    }
    field.selector = payload.selector;
    if (!field.name || field.name === 'Field' || field.name === 'Field 1') {
      field.name = payload.suggestedName || field.name || 'Field';
    }
    if (typeof payload.coverage === 'number') field._coverage = payload.coverage;
    renderFields();
    markDirty();
    toast('Field set to ' + payload.selector);
  }

  function toField(suggested, index) {
    var field = blankField(suggested.name || 'Field ' + ((index || 0) + 1));
    field.selector = suggested.selector || '';
    field.kind = suggested.kind || 'text';
    field.attribute = suggested.attribute || '';
    if (typeof suggested.coverage === 'number') field._coverage = suggested.coverage;
    return field;
  }

  function mergeFields(existing, suggested) {
    var selectors = {};
    existing.forEach(function (field) {
      if (field.selector) selectors[field.selector] = true;
    });
    var empty = existing.find(function (field) { return !field.selector; });
    suggested.forEach(function (item, index) {
      if (selectors[item.selector]) return;
      var field = toField(item, index);
      if (empty && !empty.selector) {
        empty.name = field.name;
        empty.selector = field.selector;
        empty.kind = field.kind;
        empty.attribute = field.attribute;
        empty._coverage = field._coverage;
        empty = null;
      } else {
        existing.push(field);
      }
      selectors[field.selector] = true;
    });
    return existing.slice(0, C.LIMITS.maxFields);
  }

  /* --------------------------------------------------------------- rendering */

  function renderAll() {
    if (!state.recipe) return;
    renderContext();
    renderRecipeMeta();
    renderFields();
    renderPagination();
    renderOptions();
    renderLibrary();
    renderRun();
  }

  function renderContext() {
    $('#pageTitle').textContent = state.context.title || 'No page selected';
    $('#pageUrl').textContent = state.context.url ? SS.fmt.host(state.context.url) + pathOf(state.context.url) : 'Open a web page, then open scraperStack';
    var badge = $('#pageStatus');
    var map = {
      ready: ['green', 'connected'],
      connecting: ['neutral', 'connecting'],
      picking: ['violet', 'picking…'],
      'no-content': ['amber', 'reload page'],
      unsupported: ['neutral', 'not scrapable'],
      none: ['red', 'no tab'],
      dev: ['violet', 'preview mode']
    };
    var conf = map[state.status] || map.connecting;
    badge.className = 'badge ' + conf[0];
    badge.innerHTML = '<span class="dot ' + (state.status === 'picking' || state.status === 'connecting' ? 'pulse' : '') + '"></span><span class="label">' + conf[1] + '</span>';
    $('#pageMark').innerHTML = icon(state.status === 'unsupported' || state.status === 'none' ? 'alert' : state.status === 'dev' ? 'eye' : 'globe', 14);
  }

  function pathOf(url) {
    try {
      var parsed = new URL(url);
      return parsed.pathname === '/' ? '' : parsed.pathname;
    } catch (err) {
      return '';
    }
  }

  function renderRecipeMeta() {
    if (!state.recipe) return;
    $('#recipeName').value = state.recipe.name || '';
    var picker = $('#recipePicker');
    var options = ['<option value="">＋ New recipe</option>'];
    state.recipes.forEach(function (recipe) {
      options.push(
        '<option value="' + esc(recipe.id) + '"' + (recipe.id === state.savedId ? ' selected' : '') + '>' +
        esc(recipe.name) + ' · ' + esc(SS.fmt.host(recipe.origin || recipe.url || '')) +
        '</option>'
      );
    });
    picker.innerHTML = options.join('');

    $$('#modeToggle button').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-mode') === state.recipe.mode);
    });
    $('#containerBlock').hidden = state.recipe.mode !== 'list';
    $('#containerSelector').value = state.recipe.containerSelector || '';
    $('#modeHint').textContent = state.recipe.mode === 'list'
      ? 'Pick one card or table row. scraperStack finds every sibling that matches it.'
      : 'Capture fields from this page once. Useful for detail pages and single items.';
    renderContainerBadge();
  }

  function renderContainerBadge() {
    var badge = $('#itemCount');
    if (!state.recipe.containerSelector) {
      badge.className = 'badge neutral';
      badge.textContent = 'not picked';
      return;
    }
    if (state.containerCount === null || state.containerCount === undefined) {
      badge.className = 'badge neutral';
      badge.textContent = 'saved';
      return;
    }
    if (state.containerCount === 0) {
      badge.className = 'badge red';
      badge.textContent = 'no matches';
      return;
    }
    badge.className = 'badge green';
    badge.textContent = state.containerCount + (state.containerCount === 1 ? ' item' : ' items');
  }

  function fieldCard(field) {
    var transform = field.transform || {};
    var kindOptions = FIELD_KINDS.map(function (kind) {
      return '<option value="' + kind[0] + '"' + (field.kind === kind[0] ? ' selected' : '') + '>' + kind[1] + '</option>';
    }).join('');
    var coverage = typeof field._coverage === 'number'
      ? '<span class="badge ' + (field._coverage >= 90 ? 'green' : field._coverage >= 50 ? 'amber' : 'red') + '" title="Coverage across list items">' + field._coverage + '%</span>'
      : '';
    var advanced = state.advanced.has(field.id) ? '' : ' hidden';

    return '' +
      '<div class="field-card" data-field-id="' + esc(field.id) + '">' +
        '<div class="fc-head">' +
          '<input class="fc-name" data-bind="name" value="' + esc(field.name) + '" placeholder="Field name" maxlength="60" autocomplete="off">' +
          coverage +
          '<button type="button" class="icon-btn" data-act="toggle-adv" title="Transforms">' + icon('sliders', 13) + '</button>' +
          '<button type="button" class="icon-btn danger" data-act="del-field" title="Remove field">' + icon('trash', 13) + '</button>' +
        '</div>' +
        '<div class="input-wrap">' +
          '<input class="input mono selector-input" data-bind="selector" value="' + esc(field.selector) + '" placeholder="' +
            (state.recipe.mode === 'list' ? '.title — relative to each item' : 'h1, .price, a[href]') +
          '" autocomplete="off" spellcheck="false">' +
          '<div class="trail">' +
            '<button type="button" class="icon-btn pick-btn" data-act="pick-field" title="Pick on page">' + icon('crosshair', 13) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="fc-row">' +
          '<select class="select fc-kind" data-bind="kind" title="What to capture">' + kindOptions + '</select>' +
          (field.kind === 'attribute'
            ? '<input class="input mono" data-bind="attribute" value="' + esc(field.attribute || '') + '" placeholder="attribute" spellcheck="false">'
            : '') +
          '<label class="check" title="Join every match"><input type="checkbox" data-bind="multiple"' + (field.multiple ? ' checked' : '') + '> All</label>' +
        '</div>' +
        '<div class="fc-adv"' + advanced + '>' +
          '<div class="grid-2">' +
            '<div class="field"><span class="label">Regex</span><input class="input mono" data-bind="transform.regex" value="' + esc(transform.regex || '') + '" placeholder="pattern" spellcheck="false"></div>' +
            '<div class="field"><span class="label">Replace</span><input class="input mono" data-bind="transform.replace" value="' + esc(transform.replace || '') + '" placeholder="$1" spellcheck="false"></div>' +
          '</div>' +
          '<div class="grid-2">' +
            '<div class="field"><span class="label">Flags</span><input class="input mono" data-bind="transform.flags" value="' + esc(transform.flags || 'g') + '" placeholder="g" spellcheck="false"></div>' +
            '<div class="field"><span class="label">Fallback</span><input class="input" data-bind="transform.fallback" value="' + esc(transform.fallback || '') + '" placeholder="when empty"></div>' +
          '</div>' +
          '<div class="grid-2">' +
            '<div class="field"><span class="label">Prefix</span><input class="input" data-bind="transform.prefix" value="' + esc(transform.prefix || '') + '"></div>' +
            '<div class="field"><span class="label">Suffix</span><input class="input" data-bind="transform.suffix" value="' + esc(transform.suffix || '') + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderFields() {
    var container = $('#fields');
    if (!container || !state.recipe) return;
    var fields = state.recipe.fields || [];
    $('#fieldCount').textContent = String(fields.filter(function (field) { return field.selector; }).length);
    if (!fields.length) {
      container.innerHTML = '<div class="empty"><div class="glyph">' + icon('table', 16) + '</div>' +
        '<div class="empty-title">No fields yet</div>' +
        '<div class="empty-text">Pick an element on the page, or choose a list and let Auto-detect map the common fields.</div></div>';
      return;
    }
    container.innerHTML = fields.map(fieldCard).join('');
  }

  function renderPagination() {
    var pagination = state.recipe.pagination;
    $('#paginationEnabled').checked = !!pagination.enabled;
    $('#paginationMode').value = pagination.mode || 'click';
    $('#nextSelector').value = pagination.nextSelector || '';
    $('#maxPages').value = pagination.maxPages || 5;
    $('#pageDelay').value = pagination.delayMs === undefined ? (state.settings.pageDelayMs || 1000) : pagination.delayMs;
    $('#pageWait').value = pagination.waitMs || 4000;
    $('#pageSettle').value = pagination.settleMs === undefined ? 260 : pagination.settleMs;
    $('#stopWhenNoNew').checked = pagination.stopWhenNoNew !== false;
    updatePaginationUi();
  }

  function updatePaginationUi() {
    var pagination = state.recipe.pagination;
    var mode = pagination.mode || 'click';
    $('#nextControlField').hidden = mode === 'scroll';
    $('#paginationBody').classList.toggle('is-off', !pagination.enabled);
    var hints = {
      click: 'Clicks the next button or link. If the page reloads, the run resumes automatically on the next page.',
      url: 'Fetches the next page in the background and keeps the current page open. Best for server-rendered lists.',
      loadmore: 'Clicks the same control repeatedly, collecting new items until pages stop growing.',
      scroll: 'Scrolls this page to trigger lazy loading, then captures the result. No page navigation.'
    };
    $('#paginationHint').textContent = hints[mode] || hints.click;
  }

  function renderOptions() {
    $('#dedupe').checked = state.recipe.dedupe !== false;
    $('#preScroll').checked = !!(state.recipe.scroll && state.recipe.scroll.enabled);
    $('#scrollSteps').value = (state.recipe.scroll && state.recipe.scroll.steps) || 6;
    $('#scrollDelay').value = (state.recipe.scroll && state.recipe.scroll.delayMs) || 650;
    updateOptionsUi();
    $('#runHint').textContent = state.context.scrapable
      ? (state.recipe.mode === 'list' ? 'Rows are captured per repeated item and saved to your datasets.' : 'One row is captured from this page and saved to your datasets.')
      : 'Open a normal http(s) page to run this recipe.';
  }

  function updateOptionsUi() {
    $('#scrollOptions').hidden = !$('#preScroll').checked;
  }

  function renderLibrary() {
    $('#recipeCount').textContent = String(state.recipes.length);
    $('#datasetCount').textContent = String(state.datasets.length);
    $('#libTag').textContent = String(state.recipes.length);
    $('#libTag').hidden = state.recipes.length === 0;

    var recipeList = $('#recipeList');
    if (!state.recipes.length) {
      recipeList.innerHTML = '<div class="lib-empty">No saved recipes yet. Build one and hit Save.</div>';
    } else {
      recipeList.innerHTML = state.recipes.map(function (recipe) {
        return '<div class="lib-row' + (recipe.id === state.savedId ? ' active' : '') + '" data-recipe-id="' + esc(recipe.id) + '">' +
          '<button type="button" class="lib-main" data-act="load-recipe">' +
            '<span class="lib-name">' + esc(recipe.name) + '</span>' +
            '<span class="lib-meta">' + (recipe.mode === 'single' ? 'single' : 'list') + ' · ' +
              (recipe.fields || []).length + ' fields · ' + esc(SS.fmt.host(recipe.origin || recipe.url || '')) +
              (recipe.pagination && recipe.pagination.enabled ? ' · paged' : '') +
            '</span>' +
          '</button>' +
          '<div class="lib-actions">' +
            '<button type="button" class="icon-btn" data-act="export-recipe" title="Export JSON">' + icon('download', 13) + '</button>' +
            '<button type="button" class="icon-btn" data-act="duplicate-recipe" title="Duplicate">' + icon('copy', 13) + '</button>' +
            '<button type="button" class="icon-btn danger" data-act="delete-recipe" title="Delete">' + icon('trash', 13) + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    var datasetList = $('#datasetList');
    if (!state.datasets.length) {
      datasetList.innerHTML = '<div class="lib-empty">Finished scrapes appear here with their rows.</div>';
    } else {
      datasetList.innerHTML = state.datasets.map(function (dataset) {
        return '<div class="lib-row col" data-dataset-id="' + esc(dataset.id) + '">' +
          '<div class="lib-line">' +
            '<div class="lib-main">' +
              '<span class="lib-name">' + esc(dataset.recipeName) + '</span>' +
              '<span class="lib-meta">' + SS.fmt.number(dataset.rowCount) + ' rows · ' + (dataset.pages || 1) +
                (dataset.pages === 1 ? ' page' : ' pages') + ' · ' + SS.fmt.timeAgo(dataset.createdAt) + '</span>' +
            '</div>' +
            '<div class="lib-actions">' +
              '<button type="button" class="icon-btn" data-act="preview-dataset" title="Preview">' + icon('eye', 13) + '</button>' +
              '<button type="button" class="icon-btn" data-act="export-dataset" title="Export CSV">' + icon('download', 13) + '</button>' +
              '<button type="button" class="icon-btn danger" data-act="delete-dataset" title="Delete">' + icon('trash', 13) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  function columnsOf(rows, preferred) {
    var cols = Array.isArray(preferred) && preferred.length ? preferred.slice() : [];
    rows.slice(0, 5).forEach(function (row) {
      Object.keys(row || {}).forEach(function (key) {
        if (cols.indexOf(key) === -1) cols.push(key);
      });
    });
    return cols;
  }

  function tableHtml(rows, fields, limit) {
    if (!rows || !rows.length) {
      return '<div class="empty"><div class="empty-title">No rows captured</div><div class="empty-text">The selectors did not match anything on this page. Try another field or reload the page.</div></div>';
    }
    var columns = columnsOf(rows, fields);
    var max = limit || 40;
    var head = '<thead><tr>' + columns.map(function (column) {
      return '<th>' + esc(column) + '</th>';
    }).join('') + '</tr></thead>';
    var body = rows.slice(0, max).map(function (row) {
      return '<tr>' + columns.map(function (column) {
        var value = row[column] == null ? '' : String(row[column]);
        return '<td title="' + esc(value) + '">' + (value ? esc(value) : '<span class="faint">—</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function renderRun() {
    var run = state.run;
    $('#runEmpty').hidden = !!run;
    $('#runBody').hidden = !run;
    $('#runTag').hidden = !run;
    $('#runTag').textContent = run ? '1' : '0';

    if (!run) return;

    var status = run.status || 'running';
    var badgeMap = {
      starting: ['violet', 'Starting', true],
      running: ['violet', run.phase === 'waiting' ? 'Waiting' : 'Running', true],
      stopping: ['amber', 'Stopping', true],
      preview: ['cyan', 'Preview', false],
      done: ['green', 'Complete', false],
      error: ['red', 'Stopped', false]
    };
    var conf = badgeMap[status] || badgeMap.running;
    var badge = $('#runState');
    badge.className = 'badge ' + conf[0];
    badge.innerHTML = '<span class="dot' + (conf[2] ? ' pulse' : '') + '"></span><span class="label">' + conf[1] + '</span>';

    $('#runStarted').textContent = run.startedAt ? 'started ' + SS.fmt.timeAgo(run.startedAt) : '';
    $('#runTitle').textContent = run.recipeName || state.recipe.name || 'Scrape';
    $('#metricRows').textContent = SS.fmt.number(run.rowCount || 0);
    $('#metricPages').textContent = SS.fmt.number(run.pages || run.page || 0);
    $('#metricTime').textContent = SS.fmt.duration(run.status === 'done' ? run.durationMs || 0 : Date.now() - (run.startedAt || Date.now()));
    $('#runMessage').textContent = run.message || '';

    var maxPages = run.maxPages || 1;
    var percent = status === 'done' ? 100 : Math.min(96, Math.max(4, ((run.page || 1) / Math.max(1, maxPages)) * 100));
    $('#progressBar').style.width = percent + '%';
    $('#progressWrap').classList.toggle('indeterminate', status === 'starting' || (status === 'running' && run.phase === 'waiting'));

    var running = status === 'running' || status === 'starting' || status === 'stopping';
    $('#btnStop').hidden = !running;
    $('#btnStop').disabled = status === 'stopping';
    $('#btnRunAgain').hidden = running;

    var errorBox = $('#runError');
    if (run.error) {
      errorBox.hidden = false;
      $('#runErrorText').textContent = run.error;
    } else {
      errorBox.hidden = true;
    }

    var rows = run.rows || [];
    var previewFields = state.recipe.fields.map(function (field) { return field.name; }).filter(Boolean);
    $('#previewCount').textContent = SS.fmt.number(run.rowCount || rows.length) + (run.rowCount > rows.length && rows.length ? ' rows · showing ' + rows.length : ' rows');
    $('#previewTable').innerHTML = tableHtml(rows, previewFields, 25);

    var canExport = (status === 'done' || status === 'error') && !!run.datasetId;
    $('#exportBar').hidden = !canExport;
    var hasSaved = status === 'done' || (status === 'error' && !!run.datasetId);
    $('#savedNote').hidden = !hasSaved;
    if (hasSaved) {
      $('#savedNote').textContent = (status === 'error' ? 'Partial results saved' : run.truncated ? 'Saved locally · truncated to your row limit' : 'Saved to datasets') +
        (run.pages ? ' · ' + run.pages + (run.pages === 1 ? ' page' : ' pages') : '') +
        (run.durationMs ? ' · ' + SS.fmt.duration(run.durationMs) : '');
    }
  }

  /* -------------------------------------------------------------------- run */

  function validateRecipe() {
    var recipe = currentRecipe();
    if (!recipe.fields.some(function (field) { return field.selector.trim(); })) {
      return 'Pick at least one field first.';
    }
    if (recipe.mode === 'list' && !recipe.containerSelector.trim()) {
      return 'Pick the repeating item first, or switch to Single record.';
    }
    if (recipe.mode === 'list' && !SS.util.isValidCss(recipe.containerSelector.trim())) {
      return 'The item selector is not valid CSS.';
    }
    var invalid = recipe.fields.find(function (field) {
      return field.selector.trim() && !SS.util.isValidCss(field.selector.trim());
    });
    if (invalid) return '"' + (invalid.name || 'Field') + '" has an invalid selector.';
    var pagination = recipe.pagination;
    if (pagination.enabled) {
      if (pagination.mode !== 'scroll') {
        if (!pagination.nextSelector.trim()) return 'Pagination needs a next control.';
        if (!SS.util.isValidCss(pagination.nextSelector.trim())) return 'The next-page selector is not valid CSS.';
      }
    }
    return '';
  }

  function prepareForRun() {
    var recipe = currentRecipe();
    recipe.name = (recipe.name || '').trim() || 'Quick scrape';
    recipe.origin = state.context.origin || recipe.origin || '';
    recipe.url = state.context.url || recipe.url || '';
    return recipe;
  }

  async function startRun() {
    var problem = validateRecipe();
    if (problem) {
      switchTab('build');
      toast(problem, 'warn');
      return;
    }
    if (!SS.store.isExtension) {
      toast('Load the extension to scrape a live page.', 'warn');
      return;
    }
    if (!state.context.scrapable) {
      toast('Open a regular http(s) page first.', 'warn');
      return;
    }

    var recipe = prepareForRun();
    var saved = await SS.store.saveRecipe(recipe);
    state.recipe = SS.util.normalizeRecipe(saved, null);
    state.savedId = saved.id;
    await loadRecipes();
    renderRecipeMeta();
    renderLibrary();

    var runId = SS.util.uid('run');
    state.run = {
      runId: runId,
      status: 'starting',
      phase: 'starting',
      page: 1,
      maxPages: recipe.pagination.enabled ? recipe.pagination.maxPages : 1,
      rowCount: 0,
      rows: [],
      startedAt: Date.now(),
      message: 'Starting…',
      datasetId: '',
      recipeName: saved.name,
      error: ''
    };
    switchTab('run');
    renderRun();
    startTimer();

    var res = await sendToTab({ type: MSG.RUN, payload: { recipe: saved, runId: runId } });
    if (!res || !res.ok) {
      failRun({ message: (res && res.error) || 'Could not reach the page. Reload it and try again.' });
    }
  }

  async function testRecipe() {
    var recipe = currentRecipe();
    if (!recipe.fields.some(function (field) { return field.selector.trim(); })) {
      toast('Pick at least one field first.', 'warn');
      return;
    }
    var res = await sendToTab({ type: MSG.PREVIEW, payload: { recipe: recipe } });
    if (!res || !res.ok) {
      toast('Could not reach the page. Reload it and try again.', 'warn');
      return;
    }
    var preview = res.preview || { rows: [], error: 'No preview returned.' };
    state.run = {
      runId: 'preview',
      status: 'preview',
      page: 1,
      maxPages: 1,
      rowCount: preview.rows.length,
      rows: preview.rows,
      startedAt: Date.now(),
      durationMs: 0,
      message: preview.error || (preview.containers + ' matches on this page'),
      datasetId: '',
      recipeName: recipe.name || 'Preview',
      error: preview.error || ''
    };
    switchTab('run');
    renderRun();
    toast(preview.error ? preview.error : 'Preview ready · ' + preview.rows.length + ' rows', preview.error ? 'warn' : '');
  }

  function startTimer() {
    stopTimer();
    state.runTimer = setInterval(function () {
      if (!state.run) return;
      var el = $('#metricTime');
      if (!el) return;
      if (state.run.status === 'done') return;
      el.textContent = SS.fmt.duration(Date.now() - (state.run.startedAt || Date.now()));
    }, 1000);
  }

  function stopTimer() {
    if (state.runTimer) clearInterval(state.runTimer);
    state.runTimer = 0;
  }

  function onProgress(payload) {
    if (!state.run || (payload.runId && state.run.runId !== payload.runId)) return;
    if (state.run.status === 'done' || state.run.status === 'error') return;
    state.run.status = 'running';
    state.run.phase = payload.phase || 'collecting';
    state.run.page = payload.page || state.run.page;
    state.run.maxPages = payload.maxPages || state.run.maxPages;
    state.run.rowCount = payload.rowCount || 0;
    state.run.rows = payload.rows || state.run.rows;
    state.run.message = payload.message || '';
    renderRun();
  }

  function finishRun(payload) {
    if (state.run && payload.runId && state.run.runId !== payload.runId) return;
    if (!state.run) return;
    if (state.run.status === 'done') return;
    state.run.status = 'done';
    state.run.datasetId = payload.datasetId || payload.id || state.run.datasetId;
    state.run.rowCount = payload.rowCount === undefined ? state.run.rowCount : payload.rowCount;
    state.run.pages = payload.pages || state.run.pages;
    state.run.durationMs = payload.durationMs || (Date.now() - state.run.startedAt);
    state.run.truncated = !!payload.truncated;
    state.run.rows = (payload.rows && payload.rows.length) ? payload.rows : state.run.rows;
    state.run.message = 'Collected ' + SS.fmt.number(state.run.rowCount) + ' rows' + (state.run.truncated ? ' (row limit reached)' : '');
    state.run.error = '';
    stopTimer();
    renderRun();
    toast('Scrape complete · ' + SS.fmt.number(state.run.rowCount) + ' rows');
    loadDatasets().then(renderLibrary);
  }

  function failRun(payload) {
    if (!payload || !state.run) return;
    if (payload.runId && state.run.runId !== payload.runId) return;
    state.run.status = 'error';
    state.run.datasetId = payload.datasetId || state.run.datasetId;
    state.run.error = payload.message || 'The scrape stopped unexpectedly.';
    state.run.message = state.run.error;
    stopTimer();
    renderRun();
    toast(state.run.error, 'error');
  }

  async function stopRun() {
    if (!state.run) return;
    state.run.status = 'stopping';
    state.run.message = 'Stopping after this page…';
    renderRun();
    await sendToTab({ type: MSG.STOP });
  }

  /* ---------------------------------------------------------------- exports */

  function toTSV(rows, fields) {
    var columns = columnsOf(rows, fields);
    return rows.map(function (row) {
      return columns.map(function (column) {
        return String(row[column] == null ? '' : row[column]).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      }).join('\t');
    }).join('\n');
  }

  async function loadRunDataset() {
    if (!state.run || !state.run.datasetId) return null;
    return SS.store.getDataset(state.run.datasetId);
  }

  async function exportRun(kind) {
    var dataset = await loadRunDataset();
    if (!dataset) {
      toast('Dataset is still saving. Try again in a moment.', 'warn');
      return;
    }
    var base = SS.exporters.safeFilename(dataset.recipeName + '-' + new Date(dataset.createdAt).toISOString().slice(0, 10));
    if (kind === 'csv') {
      SS.exporters.downloadText(base + '.csv', SS.exporters.toCSV(dataset.rows, dataset.fields), 'text/csv;charset=utf-8');
      toast('CSV downloaded');
    } else if (kind === 'json') {
      SS.exporters.downloadText(base + '.json', SS.exporters.toJSON(dataset.rows, {
        app: 'scraperStack',
        kind: 'dataset',
        name: dataset.recipeName,
        source: dataset.url,
        fields: dataset.fields
      }), 'application/json');
      toast('JSON downloaded');
    } else if (kind === 'copy') {
      var ok = await SS.exporters.copyText(toTSV(dataset.rows, dataset.fields));
      toast(ok ? 'Copied ' + dataset.rowCount + ' rows as TSV' : 'Copy failed', ok ? '' : 'warn');
    }
  }

  async function exportDataset(dataset, kind) {
    if (!dataset) return;
    var base = SS.exporters.safeFilename(dataset.recipeName + '-' + new Date(dataset.createdAt).toISOString().slice(0, 10));
    if (kind === 'csv') {
      SS.exporters.downloadText(base + '.csv', SS.exporters.toCSV(dataset.rows, dataset.fields), 'text/csv;charset=utf-8');
    } else {
      SS.exporters.downloadText(base + '.json', SS.exporters.toJSON(dataset.rows, {
        app: 'scraperStack',
        kind: 'dataset',
        name: dataset.recipeName,
        source: dataset.url,
        fields: dataset.fields
      }), 'application/json');
    }
    toast(kind.toUpperCase() + ' downloaded');
  }

  /* ------------------------------------------------------------------- tabs */

  function switchTab(name) {
    state.tab = name;
    $$('.tab').forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-panel') !== name;
    });
    if (name === 'library') renderLibrary();
  }

  /* ---------------------------------------------------------------- recipes */

  async function saveCurrent(silent) {
    var recipe = prepareForRun();
    var saved = await SS.store.saveRecipe(recipe);
    state.recipe = SS.util.normalizeRecipe(saved, null);
    state.savedId = saved.id;
    await loadRecipes();
    renderRecipeMeta();
    renderLibrary();
    if (!silent) toast('Recipe saved');
    return saved;
  }

  async function loadRecipe(id) {
    var found = state.recipes.find(function (recipe) { return recipe.id === id; });
    if (!found) return;
    state.recipe = SS.util.normalizeRecipe(JSON.parse(JSON.stringify(found)), null);
    state.savedId = found.id;
    state.containerCount = null;
    state.advanced = new Set();
    renderAll();
    saveDraftNow();
    switchTab('build');
    if (state.context.scrapable) refreshContainerCount();
  }

  function newRecipe() {
    state.recipe = SS.util.normalizeRecipe(blankRecipe(state.context.origin), null);
    state.savedId = null;
    state.containerCount = null;
    state.advanced = new Set();
    renderAll();
    saveDraftNow();
    switchTab('build');
  }

  function saveDraftNow() {
    if (state.recipe && state.context.origin) {
      SS.store.saveDraft(state.context.origin, state.recipe).catch(function () {});
    }
  }

  async function refreshContainerCount() {
    if (!state.recipe || !state.recipe.containerSelector || state.recipe.mode !== 'list') {
      renderContainerBadge();
      return;
    }
    if (!SS.store.isExtension || !state.context.scrapable) {
      state.containerCount = null;
      renderContainerBadge();
      return;
    }
    var res = await sendToTab({ type: MSG.COUNT, payload: { selector: state.recipe.containerSelector } });
    state.containerCount = res && res.ok ? res.count : null;
    renderContainerBadge();
  }

  async function detectList() {
    var res = await sendToTab({ type: MSG.SUGGEST_ITEMS });
    if (!res || !res.ok) {
      toast('Could not scan this page. Reload it and try again.', 'warn');
      return;
    }
    var items = res.items || [];
    var box = $('#listSuggestions');
    if (!items.length) {
      box.hidden = true;
      toast('No repeated blocks found. Pick an item manually.', 'warn');
      return;
    }
    box.hidden = false;
    box.innerHTML = items.map(function (item) {
      return '<button type="button" class="suggest-item" data-selector="' + esc(item.selector) + '" data-count="' + item.count + '">' +
        '<span class="badge neutral">' + item.count + '</span>' +
        '<span class="sel">' + esc(item.selector) + '</span>' +
        '<span class="sample">' + esc(item.sample || '') + '</span>' +
      '</button>';
    }).join('');
    toast(items.length + ' likely lists found.');
  }

  async function applySuggestion(containerSelector, count) {
    state.recipe.mode = 'list';
    state.recipe.containerSelector = containerSelector;
    state.containerCount = count;
    $('#containerSelector').value = containerSelector;
    $('#listSuggestions').hidden = true;
    renderContainerBadge();
    markDirty();

    var res = await sendToTab({ type: MSG.SUGGEST_FIELDS, payload: { selector: containerSelector } });
    if (res && res.ok && res.fields && res.fields.length) {
      var usable = state.recipe.fields.filter(function (field) { return field.selector; });
      state.recipe.fields = usable.length ? mergeFields(state.recipe.fields, res.fields) : res.fields.map(toField);
      renderFields();
      toast('Mapped ' + res.fields.length + ' fields.');
    }
  }

  async function autoFields() {
    if (!state.recipe.containerSelector) {
      detectList();
      return;
    }
    var res = await sendToTab({ type: MSG.SUGGEST_FIELDS, payload: { selector: state.recipe.containerSelector } });
    if (!res || !res.ok) {
      toast('Could not inspect the list. Reload the page and try again.', 'warn');
      return;
    }
    if (!res.fields.length) {
      toast('No obvious fields found. Pick one manually.', 'warn');
      return;
    }
    var usable = state.recipe.fields.filter(function (field) { return field.selector; });
    state.recipe.fields = usable.length ? mergeFields(state.recipe.fields, res.fields) : res.fields.map(toField);
    renderFields();
    markDirty();
    toast('Mapped ' + res.fields.length + ' fields.');
  }

  /* --------------------------------------------------------------- messages */

  function bindRuntimeMessages() {
    if (!SS.store.isExtension || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener(function (message) {
      var msg = message || {};
      var payload = msg.payload || {};
      switch (msg.type) {
        case MSG.PICK_RESULT:
          applyPick(payload);
          break;
        case MSG.PICK_CANCELLED:
          clearPicking();
          break;
        case MSG.RUN_PROGRESS:
          onProgress(payload);
          break;
        case MSG.RUN_DONE:
          finishRun(payload);
          break;
        case MSG.RUN_ERROR:
          failRun(payload);
          break;
        case MSG.DATA_CHANGED:
          loadDatasets().then(renderLibrary);
          break;
        case MSG.LOAD_RECIPE:
          if (payload.id) loadRecipe(payload.id);
          break;
        default:
          break;
      }
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes[C.KEYS.datasets]) {
        loadDatasets().then(renderLibrary);
      }
    });
  }

  async function restorePendingRun() {
    if (!SS.store.isExtension || !state.context.tabId) return;
    var res = null;
    try {
      res = await chrome.runtime.sendMessage({
        type: MSG.GET_RUN_STATE,
        payload: { tabId: state.context.tabId }
      });
    } catch (err) {
      return;
    }
    var saved = res && res.run;
    if (!saved || !saved.recipe) return;

    state.recipe = SS.util.normalizeRecipe(saved.recipe, null);
    state.savedId = state.recipes.some(function (recipe) { return recipe.id === state.recipe.id; })
      ? state.recipe.id
      : null;
    state.containerCount = null;
    state.run = {
      runId: saved.runId,
      status: 'running',
      phase: saved.awaitingNavigation ? 'waiting' : 'collecting',
      page: saved.page || 1,
      maxPages: saved.maxPages || 1,
      rowCount: (saved.rows || []).length,
      rows: (saved.rows || []).slice(0, 25),
      startedAt: saved.startedAt || Date.now(),
      message: saved.awaitingNavigation
        ? 'Waiting for page ' + (saved.page || 2) + ' to load…'
        : 'Collecting…',
      datasetId: '',
      recipeName: state.recipe.name
    };
    renderAll();
    startTimer();
    switchTab('run');
  }

  /* ------------------------------------------------------------------ toasts */

  function toast(message, kind) {
    var stack = $('#toasts');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span class="mark"></span><span>' + esc(message) + '</span>';
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s ease';
      setTimeout(function () { el.remove(); }, 230);
    }, 3400);
  }

  /* ------------------------------------------------------------------- bind */

  function bindEvents() {
    bindRuntimeMessages();

    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTab(tab.getAttribute('data-tab'));
      });
    });

    $('#recipePicker').addEventListener('change', function (event) {
      var id = event.target.value;
      if (!id) newRecipe();
      else loadRecipe(id);
    });

    $('#btnNewRecipe').addEventListener('click', newRecipe);
    $('#btnSaveRecipe').addEventListener('click', function () { saveCurrent(false); });
    $('#btnDashboard').addEventListener('click', function () { SS.panel.openDashboard(); });
    $('#btnOpenDashFoot').addEventListener('click', function () { SS.panel.openDashboard(); });
    $('#btnDashboardRun').addEventListener('click', function () { SS.panel.openDashboard(); });
    $('#btnOptions').addEventListener('click', function () {
      if (SS.store.isExtension) chrome.runtime.openOptionsPage();
      else location.href = '../options/index.html';
    });

    $('#recipeName').addEventListener('input', function (event) {
      state.recipe.name = event.target.value;
      markDirty();
    });

    $$('#modeToggle button').forEach(function (button) {
      button.addEventListener('click', function () {
        state.recipe.mode = button.getAttribute('data-mode') === 'single' ? 'single' : 'list';
        markDirty();
        renderRecipeMeta();
        renderFields();
        renderOptions();
        if (state.recipe.mode === 'list') refreshContainerCount();
      });
    });

    $('#containerSelector').addEventListener('input', function (event) {
      state.recipe.containerSelector = event.target.value;
      state.containerCount = null;
      renderContainerBadge();
      markDirty();
      scheduleCount();
    });

    $('#btnPickContainer').addEventListener('click', function () { startPick('container', ''); });
    $('#btnDetectList').addEventListener('click', detectList);
    $('#btnClearContainer').addEventListener('click', function () {
      state.recipe.containerSelector = '';
      state.containerCount = null;
      $('#containerSelector').value = '';
      renderContainerBadge();
      scheduleDraft();
    });

    $('#listSuggestions').addEventListener('click', function (event) {
      var item = event.target.closest('.suggest-item');
      if (!item) return;
      applySuggestion(item.getAttribute('data-selector'), Number(item.getAttribute('data-count')) || 0);
    });

    $('#btnAddField').addEventListener('click', function () {
      var field = blankField('Field ' + (state.recipe.fields.length + 1));
      state.recipe.fields.push(field);
      state.advanced.delete(field.id);
      renderFields();
      markDirty();
      var input = $('.field-card[data-field-id="' + field.id + '"] .fc-name');
      if (input) input.focus();
    });

    $('#btnAutoFields').addEventListener('click', autoFields);

    $('#fields').addEventListener('input', onFieldInput);
    $('#fields').addEventListener('change', onFieldInput);
    $('#fields').addEventListener('click', onFieldClick);

    $('#nextSelector').addEventListener('input', function (event) {
      state.recipe.pagination.nextSelector = event.target.value;
      markDirty();
    });
    $('#btnPickNext').addEventListener('click', function () { startPick('next', ''); });

    var buildPanel = $('[data-panel="build"]');
    buildPanel.addEventListener('input', onRecipeInput);
    buildPanel.addEventListener('change', onRecipeInput);

    $('#btnTest').addEventListener('click', testRecipe);
    $('#btnRun').addEventListener('click', startRun);
    $('#btnStop').addEventListener('click', stopRun);
    $('#btnRunAgain').addEventListener('click', function () {
      if (SS.store.isExtension && state.recipe) startRun();
      else toast('Load the extension to scrape a live page.', 'warn');
    });

    $('#btnCsv').addEventListener('click', function () { exportRun('csv'); });
    $('#btnJson').addEventListener('click', function () { exportRun('json'); });
    $('#btnCopy').addEventListener('click', function () { exportRun('copy'); });

    $('#btnExportRecipes').addEventListener('click', function () {
      SS.exporters.downloadText(
        'scraperstack-recipes.json',
        JSON.stringify({ app: 'scraperStack', kind: 'recipes', version: C.VERSION, exportedAt: new Date().toISOString(), recipes: state.recipes }, null, 2),
        'application/json'
      );
      toast('Recipes exported');
    });

    $('#btnImportRecipes').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', onImportFile);

    $('#recipeList').addEventListener('click', onRecipeListClick);
    $('#datasetList').addEventListener('click', onDatasetListClick);
  }

  function onFieldInput(event) {
    var card = event.target.closest('[data-field-id]');
    if (!card) return;
    var field = state.recipe.fields.find(function (item) { return item.id === card.getAttribute('data-field-id'); });
    if (!field) return;
    var bind = event.target.getAttribute('data-bind');
    if (!bind) return;

    if (bind === 'multiple') {
      field.multiple = event.target.checked;
    } else if (bind.indexOf('transform.') === 0) {
      var key = bind.split('.')[1];
      if (!field.transform) field.transform = {};
      field.transform[key] = event.target.value;
    } else if (bind === 'kind') {
      field.kind = event.target.value;
      renderFields();
    } else {
      field[bind] = event.target.value;
    }
    markDirty();
  }

  function onFieldClick(event) {
    var button = event.target.closest('[data-act]');
    if (!button) return;
    var card = button.closest('[data-field-id]');
    if (!card) return;
    var fieldId = card.getAttribute('data-field-id');
    var action = button.getAttribute('data-act');
    var field = state.recipe.fields.find(function (item) { return item.id === fieldId; });
    if (!field) return;

    if (action === 'del-field') {
      state.recipe.fields = state.recipe.fields.filter(function (item) { return item.id !== fieldId; });
      state.advanced.delete(fieldId);
      renderFields();
      markDirty();
    } else if (action === 'toggle-adv') {
      if (state.advanced.has(fieldId)) state.advanced.delete(fieldId);
      else state.advanced.add(fieldId);
      var adv = $('.fc-adv', card);
      if (adv) adv.hidden = !state.advanced.has(fieldId);
    } else if (action === 'pick-field') {
      startPick('field', fieldId);
    }
  }

  function onRecipeInput(event) {
    var map = INPUT_MAP[event.target.id];
    if (!map) return;
    var value;
    if (map.type === 'bool') value = event.target.checked;
    else if (map.type === 'number') {
      value = Number(event.target.value);
      if (!isFinite(value)) return;
      if (map.min !== undefined) value = Math.max(map.min, value);
      if (map.max !== undefined) value = Math.min(map.max, value);
    } else {
      value = event.target.value;
    }
    setPath(state.recipe, map.path, value);
    markDirty();
    if (map.after === 'pagination') updatePaginationUi();
    if (map.after === 'options') updateOptionsUi();
  }

  async function onRecipeListClick(event) {
    var actionEl = event.target.closest('[data-act]');
    var row = event.target.closest('[data-recipe-id]');
    if (!row) return;
    var id = row.getAttribute('data-recipe-id');
    var recipe = state.recipes.find(function (item) { return item.id === id; });
    if (!recipe) return;
    var action = actionEl ? actionEl.getAttribute('data-act') : 'load-recipe';

    if (action === 'delete-recipe') {
      if (state.settings.confirmDelete && !confirm('Delete "' + recipe.name + '"? Collected datasets stay.')) return;
      await SS.store.deleteRecipe(id);
      await loadRecipes();
      if (state.savedId === id) {
        state.savedId = null;
        state.recipe.id = '';
      }
      renderRecipeMeta();
      renderLibrary();
      toast('Recipe deleted');
      return;
    }

    if (action === 'duplicate-recipe') {
      await SS.store.duplicateRecipe(id);
      await loadRecipes();
      renderLibrary();
      toast('Recipe duplicated');
      return;
    }

    if (action === 'export-recipe') {
      SS.exporters.downloadText(
        SS.exporters.safeFilename(recipe.name) + '.json',
        JSON.stringify({ app: 'scraperStack', kind: 'recipe', version: C.VERSION, recipe: recipe }, null, 2),
        'application/json'
      );
      toast('Recipe exported');
      return;
    }

    loadRecipe(id);
  }

  async function onDatasetListClick(event) {
    var actionEl = event.target.closest('[data-act]');
    var row = event.target.closest('[data-dataset-id]');
    if (!row) return;
    var id = row.getAttribute('data-dataset-id');
    var dataset = state.datasets.find(function (item) { return item.id === id; });
    if (!dataset) return;
    var action = actionEl ? actionEl.getAttribute('data-act') : 'preview-dataset';

    if (action === 'delete-dataset') {
      if (state.settings.confirmDelete && !confirm('Delete these ' + dataset.rowCount + ' rows?')) return;
      await SS.store.deleteDataset(id);
      await loadDatasets();
      renderLibrary();
      toast('Dataset deleted');
      return;
    }

    if (action === 'export-dataset') {
      exportDataset(dataset, 'csv');
      return;
    }

    var existing = $('.dataset-preview', row);
    if (existing) {
      existing.remove();
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'dataset-preview';
    wrap.innerHTML = tableHtml(dataset.rows.slice(0, 8), dataset.fields, 8);
    row.appendChild(wrap);
  }

  async function onImportFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var parsed = JSON.parse(text);
      var backup = parsed.kind === 'recipe' && parsed.recipe ? { recipes: [parsed.recipe] } : parsed;
      var imported = await SS.store.importAll(backup);
      await loadRecipes();
      await loadDatasets();
      renderAll();
      toast('Imported ' + imported + ' item' + (imported === 1 ? '' : 's'));
    } catch (err) {
      toast('That file is not valid scraperStack JSON.', 'error');
    }
    event.target.value = '';
  }
})();
