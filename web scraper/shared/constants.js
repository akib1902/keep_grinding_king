/* scraperStack · shared constants
 * Loaded by the service worker (importScripts) and by every extension page.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    theme: 'auto',
    maxPages: 5,
    pageDelayMs: 1000,
    pageWaitMs: 1800,
    maxRows: 5000,
    maxStoredRows: 2000,
    dedupe: true,
    stopWhenNoNew: true,
    includeEmptyRows: false,
    confirmDelete: true,
    openDashboardOnInstall: true
  };

  var KEYS = {
    recipes: 'ss.recipes',
    datasets: 'ss.datasets',
    settings: 'ss.settings',
    schema: 'ss.schema',
    draftPrefix: 'ss.draft.',
    runPrefix: 'ss.run.'
  };

  var LIMITS = {
    maxRecipes: 250,
    maxDatasets: 40,
    maxFields: 40,
    maxPaginationPages: 50,
    maxPreviewRows: 50,
    maxSelectorLength: 400
  };

  var MSG = {
    PING: 'ss/ping',
    PICK: 'ss/pick',
    CANCEL_PICK: 'ss/cancel-pick',
    PICK_RESULT: 'ss/pick-result',
    PICK_CANCELLED: 'ss/pick-cancelled',
    RUN: 'ss/run',
    RUN_PROGRESS: 'ss/run-progress',
    RUN_DONE: 'ss/run-done',
    RUN_ERROR: 'ss/run-error',
    RUN_RESUMED: 'ss/run-resumed',
    STOP: 'ss/stop',
    CONTENT_READY: 'ss/content-ready',
    SUGGEST_ITEMS: 'ss/suggest-items',
    SUGGEST_FIELDS: 'ss/suggest-fields',
    COUNT: 'ss/count',
    PREVIEW: 'ss/preview',
    GET_CONTEXT: 'ss/get-context',
    SET_RUN_STATE: 'ss/set-run-state',
    CLEAR_RUN_STATE: 'ss/clear-run-state',
    GET_RUN_STATE: 'ss/get-run-state',
    SAVE_DATASET: 'ss/save-dataset',
    DATA_CHANGED: 'ss/data-changed',
    OPEN_PANEL: 'ss/open-panel',
    OPEN_DASHBOARD: 'ss/open-dashboard',
    LOAD_RECIPE: 'ss/load-recipe'
  };

  var VERSION = '1.0.0';

  root.SSConst = {
    DEFAULTS: DEFAULTS,
    KEYS: KEYS,
    LIMITS: LIMITS,
    MSG: MSG,
    VERSION: VERSION
  };
})(typeof self !== 'undefined' ? self : globalThis);
