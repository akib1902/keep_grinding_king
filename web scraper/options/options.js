/* scraperStack · options controller */
(function () {
  'use strict';

  var C = window.SSConst;
  var SS = window.SS;
  var icon = function (name, size) { return SS.icons.get(name, size || 14); };
  var esc = function (value) { return SS.dom.escape(value); };
  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  var NUMBER_FIELDS = {
    maxPages: [1, 50],
    pageDelayMs: [0, 8000],
    pageWaitMs: [500, 15000],
    maxRows: [10, 10000],
    maxStoredRows: [100, 20000]
  };

  var CHECK_FIELDS = ['dedupe', 'stopWhenNoNew', 'includeEmptyRows', 'confirmDelete', 'openDashboardOnInstall'];

  var state = { settings: {}, recipes: 0, datasets: 0 };
  var saveTimer = 0;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    hydrateIcons();
    await SS.theme.init();
    state.settings = await SS.store.getSettings();
    state.recipes = (await SS.store.getRecipes()).length;
    state.datasets = (await SS.store.getDatasets()).length;
    fillForm();
    bind();
    await refreshUsage();
  }

  function hydrateIcons() {
    $$('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.getAttribute('data-icon'), 14);
    });
  }

  function fillForm() {
    Object.keys(NUMBER_FIELDS).forEach(function (key) {
      var input = $('#' + key);
      if (input) input.value = state.settings[key];
    });
    CHECK_FIELDS.forEach(function (key) {
      var input = $('#' + key);
      if (input) input.checked = !!state.settings[key];
    });
    $$('#themePicker button').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-theme-choice') === (state.settings.theme || 'auto'));
    });
    $('#version').textContent = C.VERSION;
    $('#dataCounts').textContent = state.recipes + ' recipes · ' + state.datasets + ' datasets';
  }

  function readForm() {
    var next = {};
    Object.keys(NUMBER_FIELDS).forEach(function (key) {
      var input = $('#' + key);
      var bounds = NUMBER_FIELDS[key];
      var value = Number(input.value);
      if (!isFinite(value)) value = bounds[0];
      next[key] = Math.min(bounds[1], Math.max(bounds[0], value));
      input.value = next[key];
    });
    CHECK_FIELDS.forEach(function (key) {
      var input = $('#' + key);
      if (input) next[key] = input.checked;
    });
    $$('#themePicker button').forEach(function (button) {
      if (button.classList.contains('active')) next.theme = button.getAttribute('data-theme-choice');
    });
    return next;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 320);
  }

  async function saveNow() {
    state.settings = await SS.store.saveSettings(readForm());
    SS.theme.apply(state.settings.theme);
    var badge = $('#savedState');
    badge.hidden = false;
    setTimeout(function () { badge.hidden = true; }, 1600);
  }

  function bind() {
    Object.keys(NUMBER_FIELDS).forEach(function (key) {
      $('#' + key).addEventListener('change', scheduleSave);
    });
    CHECK_FIELDS.forEach(function (key) {
      var input = $('#' + key);
      if (input) input.addEventListener('change', scheduleSave);
    });

    $$('#themePicker button').forEach(function (button) {
      button.addEventListener('click', function () {
        $$('#themePicker button').forEach(function (other) { other.classList.remove('active'); });
        button.classList.add('active');
        SS.theme.apply(button.getAttribute('data-theme-choice'));
        scheduleSave();
      });
    });

    $('#btnExportBackup').addEventListener('click', exportBackup);
    $('#btnImport').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', importBackup);
    $('#btnClearDatasets').addEventListener('click', clearDatasets);
    $('#btnReset').addEventListener('click', resetEverything);
    $('#btnShortcuts').addEventListener('click', async function () {
      var ok = await SS.exporters.copyText('chrome://extensions/shortcuts');
      toast(ok ? 'Shortcut URL copied. Paste it into a new tab.' : 'Open chrome://extensions/shortcuts to change the shortcut.');
    });
  }

  async function refreshUsage() {
    var bytes = await SS.store.storageUsage();
    $('#usage').textContent = SS.fmt.bytes(bytes);
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

  async function importBackup(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      var parsed = JSON.parse(await file.text());
      var backup = parsed.kind === 'recipe' && parsed.recipe ? { recipes: [parsed.recipe] } : parsed;
      var count = await SS.store.importAll(backup);
      state.recipes = (await SS.store.getRecipes()).length;
      state.datasets = (await SS.store.getDatasets()).length;
      state.settings = await SS.store.getSettings();
      fillForm();
      await refreshUsage();
      toast('Imported ' + count + ' item' + (count === 1 ? '' : 's'));
    } catch (err) {
      toast('That file is not valid scraperStack JSON.', 'error');
    }
    event.target.value = '';
  }

  async function clearDatasets() {
    if (!state.datasets) {
      toast('There are no datasets to clear.', 'warn');
      return;
    }
    if (!confirm('Delete all ' + state.datasets + ' datasets? Recipes and settings stay.')) return;
    await SS.store.clearDatasets();
    state.datasets = 0;
    fillForm();
    await refreshUsage();
    toast('Datasets cleared');
  }

  async function resetEverything() {
    if (!confirm('Reset scraperStack? This deletes every recipe, dataset, draft and setting on this computer.')) return;
    await SS.store.resetAll();
    state.settings = await SS.store.getSettings();
    state.recipes = 0;
    state.datasets = 0;
    SS.theme.apply(state.settings.theme);
    fillForm();
    await refreshUsage();
    toast('Workspace reset');
  }

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
    }, 3200);
  }
})();
