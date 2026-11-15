/* scraperStack · dashboard controller */
(function () {
  'use strict';

  var C = window.SSConst;
  var SS = window.SS;
  var icon = function (name, size) { return SS.icons.get(name, size || 14); };
  var esc = function (value) { return SS.dom.escape(value); };
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var state = {
    recipes: [],
    datasets: [],
    settings: {},
    section: 'overview',
    storageBytes: 0,
    filterRecipes: '',
    filterDatasets: ''
  };

  var META = {
    overview: ['Overview', 'Recipes, datasets and everything you have collected.'],
    recipes: ['Recipes', 'Reusable scraping blueprints, one per kind of page.'],
    datasets: ['Datasets', 'Every completed run, saved locally and ready to export.']
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    hydrateIcons();
    await SS.theme.init();
    if (!SS.store.isExtension && new URLSearchParams(location.search).get('demo') === '1') {
      await SS.store.seedDemo();
    }
    state.settings = await SS.store.getSettings();
    await load();
    bind();
    route();
    if (new URLSearchParams(location.search).get('welcome') === '1') {
      $('#welcome').hidden = false;
    }
  }

  function hydrateIcons() {
    $$('[data-icon]').forEach(function (el) {
      var size = Number(el.getAttribute('data-size')) || 14;
      el.innerHTML = icon(el.getAttribute('data-icon'), size);
    });
  }

  async function load() {
    state.recipes = await SS.store.getRecipes();
    state.datasets = await SS.store.getDatasets();
    state.storageBytes = await SS.store.storageUsage();
  }

  /* ------------------------------------------------------------------ route */

  function route() {
    var hash = (location.hash || '#overview').replace('#', '');
    var section = ['overview', 'recipes', 'datasets'].indexOf(hash) !== -1 ? hash : 'overview';
    state.section = section;

    $$('.nav-item[data-nav]').forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-nav') === section);
    });
    $$('.section').forEach(function (el) {
      el.hidden = el.id !== 'section' + section.charAt(0).toUpperCase() + section.slice(1);
    });
    $('#pageTitle').textContent = META[section][0];
    $('#pageSub').textContent = META[section][1];
    renderAll();
  }

  function renderAll() {
    $('#navRecipes').textContent = String(state.recipes.length);
    $('#navDatasets').textContent = String(state.datasets.length);
    $('#storageMini').textContent = SS.fmt.bytes(state.storageBytes);
    renderStats();
    renderRecent();
    renderOverviewRecipes();
    renderRecipeTable();
    renderDatasetGrid();
  }

  function go(section) {
    if (location.hash === '#' + section) route();
    else location.hash = '#' + section;
  }

  /* ------------------------------------------------------------------ stats */

  function totalRows() {
    return state.datasets.reduce(function (sum, dataset) {
      return sum + (Number(dataset.rowCount) || (dataset.rows ? dataset.rows.length : 0));
    }, 0);
  }

  function latestRun() {
    return state.datasets.length ? Math.max.apply(null, state.datasets.map(function (dataset) {
      return dataset.createdAt || 0;
    })) : 0;
  }

  function statCard(iconName, label, value, sub) {
    return '<div class="stat">' +
      '<div class="top">' + icon(iconName, 12) + esc(label) + '</div>' +
      '<b>' + esc(value) + '</b>' +
      '<span class="sub">' + esc(sub) + '</span>' +
    '</div>';
  }

  function renderStats() {
    var container = $('#stats');
    if (!container) return;
    container.innerHTML =
      statCard('layers', 'Recipes', SS.fmt.number(state.recipes.length), state.recipes.length === 1 ? 'reusable blueprint' : 'reusable blueprints') +
      statCard('database', 'Datasets', SS.fmt.number(state.datasets.length), 'saved runs') +
      statCard('table', 'Rows captured', SS.fmt.number(totalRows()), 'across all datasets') +
      statCard('clock', 'Latest run', latestRun() ? SS.fmt.timeAgo(latestRun()) : '—', latestRun() ? 'last collection' : 'nothing yet');
  }

  /* ----------------------------------------------------------------- recent */

  function renderRecent() {
    var container = $('#recentList');
    if (!container) return;
    if (!state.datasets.length) {
      container.innerHTML = emptyBlock('database', 'No runs yet', 'Open the side panel on a page, pick an item, and run your first scrape.', 'Open the scraper', 'btnPanelRecent');
      return;
    }
    container.innerHTML = state.datasets.slice(0, 6).map(function (dataset) {
      return '<div class="row-item">' +
        '<div class="row-icon">' + icon('table', 14) + '</div>' +
        '<div class="row-copy">' +
          '<div class="row-name">' + esc(dataset.recipeName) + '</div>' +
          '<div class="row-meta">' + SS.fmt.number(dataset.rowCount) + ' rows · ' + (dataset.pages || 1) +
            (dataset.pages === 1 ? ' page' : ' pages') + ' · ' + SS.fmt.timeAgo(dataset.createdAt) +
            (dataset.origin ? ' · ' + esc(SS.fmt.host(dataset.origin)) : '') +
          '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button type="button" class="icon-btn" data-act="preview-dataset" data-id="' + esc(dataset.id) + '" title="Preview">' + icon('eye', 13) + '</button>' +
          '<button type="button" class="icon-btn" data-act="csv-dataset" data-id="' + esc(dataset.id) + '" title="Download CSV">' + icon('download', 13) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
    var recentBtn = $('#btnPanelRecent');
    if (recentBtn) recentBtn.addEventListener('click', openPanel);
  }

  function renderOverviewRecipes() {
    var container = $('#overviewRecipes');
    if (!container) return;
    if (!state.recipes.length) {
      container.innerHTML = emptyBlock('layers', 'No recipes yet', 'Recipes remember a picker session so you can re-run it any time. Build the first one in the side panel.', 'Build a recipe', 'btnPanelBuild');
      var buildBtn = $('#btnPanelBuild');
      if (buildBtn) buildBtn.addEventListener('click', openPanel);
      return;
    }
    container.innerHTML = state.recipes.slice(0, 5).map(function (recipe) {
      return '<div class="row-item">' +
        '<div class="row-icon">' + icon('layers', 14) + '</div>' +
        '<div class="row-copy">' +
          '<div class="row-name">' + esc(recipe.name) + '</div>' +
          '<div class="row-meta">' + (recipe.mode === 'single' ? 'single record' : 'repeating list') + ' · ' +
            (recipe.fields || []).length + ' fields · ' + esc(SS.fmt.host(recipe.origin || recipe.url || 'any site')) +
          '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button type="button" class="btn sm" data-act="open-recipe" data-id="' + esc(recipe.id) + '">' + icon('crosshair', 12) + ' Open</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function emptyBlock(iconName, title, text, actionLabel, actionId) {
    return '<div class="empty-block">' +
      '<div class="glyph">' + icon(iconName, 16) + '</div>' +
      '<strong>' + esc(title) + '</strong>' +
      '<p>' + esc(text) + '</p>' +
      (actionLabel ? '<button type="button" class="btn sm" id="' + esc(actionId) + '" style="margin-top:10px">' + esc(actionLabel) + '</button>' : '') +
    '</div>';
  }

  /* ---------------------------------------------------------------- recipes */

  function renderRecipeTable() {
    var container = $('#recipeTable');
    if (!container) return;
    var filter = state.filterRecipes.trim().toLowerCase();
    var recipes = state.recipes.filter(function (recipe) {
      if (!filter) return true;
      return (recipe.name || '').toLowerCase().indexOf(filter) !== -1 ||
        (recipe.origin || '').toLowerCase().indexOf(filter) !== -1 ||
        (recipe.url || '').toLowerCase().indexOf(filter) !== -1;
    });

    if (!state.recipes.length) {
      container.innerHTML = emptyBlock('layers', 'Nothing saved yet', 'A recipe stores your item selector, fields, transforms and pagination. Build it once in the side panel, then re-use it on any matching page.', 'Open the scraper', 'btnPanelRecipesEmpty');
      var btn = $('#btnPanelRecipesEmpty');
      if (btn) btn.addEventListener('click', openPanel);
      return;
    }

    if (!recipes.length) {
      container.innerHTML = '<div class="empty-block"><strong>No recipes match</strong><p>Try a different name or host.</p></div>';
      return;
    }

    var rows = recipes.map(function (recipe) {
      return '<div class="r-row">' +
        '<div class="r-name"><b>' + esc(recipe.name) + '</b><span>' +
          (recipe.url ? esc(SS.fmt.host(recipe.url)) : 'any matching page') +
          (recipe.pagination && recipe.pagination.enabled ? ' · ' + esc(recipe.pagination.mode || 'click') + ' pagination' : '') +
        '</span></div>' +
        '<div><span class="mini-pill">' + (recipe.mode === 'single' ? 'single' : 'list') + '</span></div>' +
        '<div class="muted">' + (recipe.fields || []).length + '</div>' +
        '<div class="r-updated">' + SS.fmt.timeAgo(recipe.updatedAt || recipe.createdAt) + '</div>' +
        '<div class="r-actions">' +
          '<button type="button" class="icon-btn" data-act="open-recipe" data-id="' + esc(recipe.id) + '" title="Open in side panel">' + icon('crosshair', 13) + '</button>' +
          '<button type="button" class="icon-btn" data-act="edit-recipe" data-id="' + esc(recipe.id) + '" title="Edit JSON">' + icon('sliders', 13) + '</button>' +
          '<button type="button" class="icon-btn" data-act="duplicate-recipe" data-id="' + esc(recipe.id) + '" title="Duplicate">' + icon('copy', 13) + '</button>' +
          '<button type="button" class="icon-btn" data-act="export-recipe" data-id="' + esc(recipe.id) + '" title="Export JSON">' + icon('download', 13) + '</button>' +
          '<button type="button" class="icon-btn danger" data-act="delete-recipe" data-id="' + esc(recipe.id) + '" title="Delete">' + icon('trash', 13) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML =
      '<div class="r-table">' +
        '<div class="r-head"><span>Recipe</span><span>Mode</span><span>Fields</span><span>Updated</span><span></span></div>' +
        rows +
      '</div>';
  }

  /* --------------------------------------------------------------- datasets */

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
    if (!rows || !rows.length) return '<div class="empty-block"><p>No rows.</p></div>';
    var columns = columnsOf(rows, fields);
    var head = '<thead><tr>' + columns.map(function (column) {
      return '<th>' + esc(column) + '</th>';
    }).join('') + '</tr></thead>';
    var body = rows.slice(0, limit || 100).map(function (row) {
      return '<tr>' + columns.map(function (column) {
        var value = row[column] == null ? '' : String(row[column]);
        return '<td title="' + esc(value) + '">' + (value ? esc(value) : '<span class="faint">—</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function renderDatasetGrid() {
    var container = $('#datasetList');
    if (!container) return;
    var filter = state.filterDatasets.trim().toLowerCase();
    var datasets = state.datasets.filter(function (dataset) {
      if (!filter) return true;
      return (dataset.recipeName || '').toLowerCase().indexOf(filter) !== -1 ||
        (dataset.origin || '').toLowerCase().indexOf(filter) !== -1 ||
        (dataset.url || '').toLowerCase().indexOf(filter) !== -1;
    });

    if (!state.datasets.length) {
      container.innerHTML = emptyBlock('database', 'No datasets yet', 'Finished scrapes are saved here automatically, even if the side panel is closed.', 'Open the scraper', 'btnPanelDatasetsEmpty');
      var btn = $('#btnPanelDatasetsEmpty');
      if (btn) btn.addEventListener('click', openPanel);
      return;
    }

    if (!datasets.length) {
      container.innerHTML = emptyBlock('search', 'No datasets match', 'Try a different recipe name or host.', '', '');
      return;
    }

    container.innerHTML = datasets.map(function (dataset) {
      return '<article class="card ds-card">' +
        '<div class="ds-head">' +
          '<div class="row-copy">' +
            '<h3>' + esc(dataset.recipeName) + '</h3>' +
            '<p>' + (dataset.origin ? esc(SS.fmt.host(dataset.origin)) : 'unknown source') + ' · ' + SS.fmt.date(dataset.createdAt) + '</p>' +
          '</div>' +
          '<span class="badge ' + (dataset.truncated ? 'amber' : 'neutral') + '">' + SS.fmt.number(dataset.rowCount) + ' rows</span>' +
        '</div>' +
        '<div class="ds-preview">' + tableHtml(dataset.rows.slice(0, 3), dataset.fields, 3) + '</div>' +
        '<div class="ds-foot">' +
          '<button type="button" class="btn sm ghost" data-act="preview-dataset" data-id="' + esc(dataset.id) + '">' + icon('eye', 11) + ' Preview</button>' +
          '<button type="button" class="btn sm ghost" data-act="csv-dataset" data-id="' + esc(dataset.id) + '">' + icon('download', 11) + ' CSV</button>' +
          '<span class="spacer"></span>' +
          '<span class="ds-source" title="' + esc(dataset.url) + '">' + (dataset.pages || 1) + 'p</span>' +
          '<button type="button" class="icon-btn danger" data-act="delete-dataset" data-id="' + esc(dataset.id) + '" title="Delete">' + icon('trash', 13) + '</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ------------------------------------------------------------------ modal */

  function openModal(options) {
    $('#modalTitle').textContent = options.title;
    $('#modalBody').innerHTML = options.body || '';
    var modal = $('#modal .modal');
    modal.classList.toggle('wide', !!options.wide);
    var foot = $('#modalFoot');
    foot.innerHTML = '';
    (options.actions || []).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = action.className || 'btn';
      button.textContent = action.label;
      button.addEventListener('click', function () {
        action.onClick(closeModal);
      });
      foot.appendChild(button);
    });
    $('#modal').hidden = false;
  }

  function closeModal() {
    $('#modal').hidden = true;
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
  }

  function openDatasetModal(dataset) {
    openModal({
      title: dataset.recipeName,
      wide: true,
      body:
        '<div class="between" style="margin-bottom:10px">' +
          '<div class="row">' +
            '<span class="badge violet">' + SS.fmt.number(dataset.rowCount) + ' rows</span>' +
            '<span class="badge neutral">' + (dataset.pages || 1) + (dataset.pages === 1 ? ' page' : ' pages') + '</span>' +
            (dataset.truncated ? '<span class="badge amber">truncated</span>' : '') +
            '<span class="hint">' + esc(SS.fmt.date(dataset.createdAt)) + '</span>' +
          '</div>' +
        '</div>' +
        (dataset.url ? '<p class="hint" style="margin-bottom:10px;word-break:break-all">' + esc(dataset.url) + '</p>' : '') +
        tableHtml(dataset.rows, dataset.fields, 100) +
        '<p class="hint" style="margin-top:8px">Showing ' + Math.min(100, dataset.rows.length) + ' of ' + SS.fmt.number(dataset.rowCount) + ' rows. Exports include all saved rows.</p>',
      actions: [
        { label: 'Export CSV', className: 'btn', onClick: function () { downloadDataset(dataset, 'csv'); } },
        { label: 'Export JSON', className: 'btn', onClick: function () { downloadDataset(dataset, 'json'); } },
        { label: 'Close', className: 'btn ghost', onClick: function (close) { close(); } }
      ]
    });
  }

  function openRecipeModal(recipe) {
    openModal({
      title: 'Edit ' + recipe.name,
      wide: true,
      body:
        '<p class="hint" style="margin-bottom:8px">Editing the raw recipe. Selectors are relative to each list item in list mode.</p>' +
        '<textarea class="textarea json-editor" id="recipeJson" spellcheck="false"></textarea>' +
        '<div class="modal-error" id="jsonError" hidden></div>',
      actions: [
        { label: 'Save recipe', className: 'btn primary', onClick: saveRecipeJson },
        { label: 'Cancel', className: 'btn ghost', onClick: function (close) { close(); } }
      ]
    });
    $('#recipeJson').value = JSON.stringify(recipe, null, 2);
  }

  async function saveRecipeJson(close) {
    var textarea = $('#recipeJson');
    var error = $('#jsonError');
    try {
      var parsed = JSON.parse(textarea.value);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fields)) {
        throw new Error('A recipe needs a name, fields array and mode.');
      }
      await SS.store.saveRecipe(parsed);
      await load();
      renderAll();
      close();
      toast('Recipe updated');
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  }

  /* ----------------------------------------------------------------- export */

  function downloadDataset(dataset, kind) {
    var base = SS.exporters.safeFilename(dataset.recipeName + '-' + new Date(dataset.createdAt || Date.now()).toISOString().slice(0, 10));
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

  async function exportBackup() {
    var backup = await SS.store.exportAll();
    SS.exporters.downloadText(
      'scraperstack-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(backup, null, 2),
      'application/json'
    );
    toast('Backup downloaded');
  }

  async function openPanel() {
    var ok = await SS.panel.open();
    if (!ok) toast('Open scraperStack from the toolbar to start picking.', 'warn');
  }

  async function openRecipeInPanel(id) {
    var ok = await SS.panel.openRecipe(id);
    if (!ok) toast('Open scraperStack from the toolbar, then choose this recipe from the picker.', 'warn');
  }

  /* ----------------------------------------------------------------- events */

  function bind() {
    $$('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () {
        go(el.getAttribute('data-nav'));
      });
    });
    window.addEventListener('hashchange', route);

    ['btnPanel', 'btnPanelTop', 'btnPanelQuick'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', openPanel);
    });

    $('#btnExportBackup').addEventListener('click', exportBackup);
    $('#btnExportAll').addEventListener('click', exportBackup);
    $('#btnNewRecipe').addEventListener('click', openPanel);
    $('#btnDismissWelcome').addEventListener('click', function () {
      $('#welcome').hidden = true;
      var url = new URL(location.href);
      url.searchParams.delete('welcome');
      history.replaceState(null, '', url.toString());
    });

    $('#recipeSearch').addEventListener('input', function (event) {
      state.filterRecipes = event.target.value;
      renderRecipeTable();
    });
    $('#datasetSearch').addEventListener('input', function (event) {
      state.filterDatasets = event.target.value;
      renderDatasetGrid();
    });

    $('#btnImportRecipes').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', onImport);
    $('#btnClearDatasets').addEventListener('click', async function () {
      if (!state.datasets.length) return;
      if (!confirm('Delete all ' + state.datasets.length + ' datasets? This cannot be undone.')) return;
      await SS.store.clearDatasets();
      await load();
      renderAll();
      toast('All datasets deleted');
    });

    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (event) {
      if (event.target === $('#modal')) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('#modal').hidden) closeModal();
    });

    document.addEventListener('click', onActionClick);
  }

  async function onActionClick(event) {
    var button = event.target.closest('[data-act]');
    if (!button) return;
    var action = button.getAttribute('data-act');
    var id = button.getAttribute('data-id');
    var recipe = state.recipes.find(function (item) { return item.id === id; });
    var dataset = state.datasets.find(function (item) { return item.id === id; });

    switch (action) {
      case 'open-recipe':
        await openRecipeInPanel(id);
        break;

      case 'edit-recipe':
        if (recipe) openRecipeModal(recipe);
        break;

      case 'duplicate-recipe':
        if (!recipe) return;
        await SS.store.duplicateRecipe(id);
        await load();
        renderAll();
        toast('Recipe duplicated');
        break;

      case 'export-recipe':
        if (!recipe) return;
        SS.exporters.downloadText(
          SS.exporters.safeFilename(recipe.name) + '.json',
          JSON.stringify({ app: 'scraperStack', kind: 'recipe', version: C.VERSION, recipe: recipe }, null, 2),
          'application/json'
        );
        toast('Recipe exported');
        break;

      case 'delete-recipe':
        if (!recipe) return;
        if (!confirm('Delete "' + recipe.name + '"? Datasets stay untouched.')) return;
        await SS.store.deleteRecipe(id);
        await load();
        renderAll();
        toast('Recipe deleted');
        break;

      case 'preview-dataset':
        if (dataset) openDatasetModal(dataset);
        break;

      case 'csv-dataset':
        if (dataset) downloadDataset(dataset, 'csv');
        break;

      case 'json-dataset':
        if (dataset) downloadDataset(dataset, 'json');
        break;

      case 'delete-dataset':
        if (!dataset) return;
        if (!confirm('Delete ' + dataset.rowCount + ' rows from "' + dataset.recipeName + '"?')) return;
        await SS.store.deleteDataset(id);
        await load();
        renderAll();
        toast('Dataset deleted');
        break;

      default:
        break;
    }
  }

  async function onImport(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      var parsed = JSON.parse(await file.text());
      var backup = parsed.kind === 'recipe' && parsed.recipe ? { recipes: [parsed.recipe] } : parsed;
      var count = await SS.store.importAll(backup);
      await load();
      renderAll();
      toast('Imported ' + count + ' item' + (count === 1 ? '' : 's'));
    } catch (err) {
      toast('That file is not valid scraperStack JSON.', 'error');
    }
    event.target.value = '';
  }

  /* ----------------------------------------------------------------- toasts */

  function toast(message, kind) {
    var stack = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span class="mark"></span><span>' + esc(message) + '</span>';
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s ease';
      setTimeout(function () { el.remove(); }, 220);
    }, 3400);
  }
})();
