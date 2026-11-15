/* scraperStack · content script
 * Handles the on-page picker, auto-detection and the scrape run itself.
 * Injected on http(s) pages at document_idle; all UI lives in a shadow root.
 */
(function () {
  'use strict';

  if (window.__scraperStackLoaded) return;
  window.__scraperStackLoaded = true;

  var SEL = window.SSSelectors;
  var EX = window.SSExtractor;
  var C = window.SSConst || {};
  var MSG = (C && C.MSG) || {
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
    SET_RUN_STATE: 'ss/set-run-state',
    CLEAR_RUN_STATE: 'ss/clear-run-state',
    GET_RUN_STATE: 'ss/get-run-state',
    SAVE_DATASET: 'ss/save-dataset'
  };
  var DEFAULTS = (C && C.DEFAULTS) || {
    pageWaitMs: 1800,
    pageDelayMs: 1000,
    maxRows: 5000,
    dedupe: true,
    stopWhenNoNew: true,
    includeEmptyRows: false
  };

  var state = {
    picking: null,
    hovered: null,
    hoverPoint: null,
    selectorCache: new WeakMap(),
    overlay: null,
    shadow: null,
    host: null,
    toastTimer: 0,
    flashTimer: 0,
    run: null,
    settings: null,
    rafPending: false
  };

  /* ------------------------------------------------------------------ utils */

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, ms));
    });
  }

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function qsa(scope, selector) {
    if (!scope || !selector) return [];
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function post(type, payload) {
    try {
      var result = chrome.runtime.sendMessage({ type: type, payload: payload || {} });
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (err) {
      /* extension was reloaded; nothing to do */
    }
  }

  function postAwait(type, payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: type, payload: payload || {} }, function (response) {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  function getSettings() {
    if (state.settings) return Promise.resolve(state.settings);
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(C.KEYS ? C.KEYS.settings : 'ss.settings', function (data) {
          var stored = (data && data[(C.KEYS ? C.KEYS.settings : 'ss.settings')]) || {};
          state.settings = Object.assign({}, DEFAULTS, stored);
          resolve(state.settings);
        });
      } catch (err) {
        state.settings = Object.assign({}, DEFAULTS);
        resolve(state.settings);
      }
    });
  }

  function isOurNode(node) {
    if (!state.host || !node) return false;
    if (node === state.host) return true;
    if (typeof node.closest === 'function' && node.closest('#__scraperstack_host__')) return true;
    return false;
  }

  /* ----------------------------------------------------------------- picker */

  var OVERLAY_CSS = [
    ':host{all:initial;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;}',
    '*{box-sizing:border-box;}',
    '.hl{position:fixed;display:none;border:2px solid #8b5cf6;background:rgba(139,92,246,.12);',
    'border-radius:4px;box-shadow:0 0 0 1px rgba(13,15,25,.55),0 10px 30px rgba(0,0,0,.25);',
    'transition:top .05s linear,left .05s linear,width .05s linear,height .05s linear;pointer-events:none;}',
    '.hl.on{display:block;}',
    '.flash{position:fixed;border:2px solid #22d3ee;background:rgba(34,211,238,.10);border-radius:4px;pointer-events:none;}',
    '.tip{position:fixed;display:none;max-width:420px;padding:7px 9px;border-radius:8px;',
    'background:#0b0d14;color:#e6e9f2;border:1px solid #2b3044;font:600 11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;',
    'box-shadow:0 8px 22px rgba(0,0,0,.4);pointer-events:none;z-index:3;}',
    '.tip.on{display:block;}',
    '.tip b{color:#a78bfa;font-weight:700;}',
    '.tip span{color:#8d95ab;font-weight:500;}',
    '.hud{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;',
    'padding:10px 12px 10px 14px;border-radius:14px;background:rgba(13,16,28,.96);color:#eef0f7;',
    'border:1px solid #2c3247;box-shadow:0 18px 50px rgba(0,0,0,.45);pointer-events:auto;z-index:4;backdrop-filter:blur(8px);}',
    '.hud .dot{width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 0 4px rgba(167,139,250,.18);}',
    '.hud .txt{font-size:12.5px;line-height:1.3;white-space:nowrap;color:#cbd2e5;}',
    '.hud .txt b{color:#fff;font-weight:650;}',
    '.hud kbd{font:600 10px ui-monospace,monospace;padding:18x;padding:2px 5px;border-radius:5px;background:#1d2233;border:1px solid #343b52;color:#aeb7d0;}',
    '.hud button{all:unset;cursor:pointer;padding:7px 11px;border-radius:8px;font-size:12px;font-weight:650;',
    'background:#222840;color:#dfe4f2;border:1px solid #363d57;}',
    '.hud button:hover{background:#2b3350;}',
    '.toast{position:fixed;left:24px;bottom:24px;display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:11px;',
    'background:rgba(13,16,28,.97);color:#e8ebf4;border:1px solid #2c3247;box-shadow:0 14px 40px rgba(0,0,0,.4);',
    'font-size:12.5px;opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s;pointer-events:none;z-index:5;}',
    '.toast.on{opacity:1;transform:translateY(0);}',
    '.toast .mark{width:7px;height:7px;border-radius:50%;background:#22d3ee;}',
    '.toast b{color:#fff;font-weight:650;}',
    '.toast span{color:#98a1b8;}'
  ].join('');

  function ensureOverlay() {
    if (state.host && document.documentElement.contains(state.host)) return;
    var host = document.createElement('div');
    host.id = '__scraperstack_host__';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + OVERLAY_CSS + '</style>' +
      '<div class="hl" part="highlight"></div>' +
      '<div class="layer"></div>' +
      '<div class="tip"></div>' +
      '<div class="hud" hidden>' +
      '  <span class="dot"></span>' +
      '  <span class="txt"><b>scraperStack</b> · <span class="mode">pick an element</span></span>' +
      '  <button type="button" class="cancel">Cancel <span style="opacity:.55">Esc</span></button>' +
      '</div>' +
      '<div class="toast"><span class="mark"></span><span class="msg"></span></div>';

    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
    state.overlay = {
      highlight: shadow.querySelector('.hl'),
      layer: shadow.querySelector('.layer'),
      tooltip: shadow.querySelector('.tip'),
      hud: shadow.querySelector('.hud'),
      hudMode: shadow.querySelector('.mode'),
      toast: shadow.querySelector('.toast'),
      toastMsg: shadow.querySelector('.msg')
    };
    shadow.querySelector('.cancel').addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      cancelPicking();
    });
  }

  function setCursorMode(on) {
    var id = '__scraperstack_cursor__';
    var style = document.getElementById(id);
    if (on) {
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        style.textContent =
          'html.__ss_picking__,html.__ss_picking__ *{cursor:crosshair!important;}' +
          'html.__ss_picking__{user-select:none!important;}';
        (document.head || document.documentElement).appendChild(style);
      }
      document.documentElement.classList.add('__ss_picking__');
    } else {
      document.documentElement.classList.remove('__ss_picking__');
      if (style) style.remove();
    }
  }

  function toast(message, mark) {
    ensureOverlay();
    var el = state.overlay.toast;
    state.overlay.toastMsg.innerHTML = message;
    el.classList.add('on');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('on');
    }, 3000);
  }

  function positionTooltip(x, y, html) {
    var tip = state.overlay.tooltip;
    tip.innerHTML = html;
    tip.classList.add('on');
    var pad = 14;
    var rect = tip.getBoundingClientRect();
    var left = x + pad;
    var top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width - pad);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - rect.height - pad);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function paintHighlight(el, x, y) {
    var box = state.overlay.highlight;
    if (!el) {
      box.classList.remove('on');
      state.overlay.tooltip.classList.remove('on');
      return;
    }
    var rect = el.getBoundingClientRect();
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = Math.max(0, rect.width) + 'px';
    box.style.height = Math.max(0, rect.height) + 'px';
    box.classList.add('on');

    var cached = state.selectorCache.get(el);
    var detail = '';
    if (cached) {
      detail = ' <span>' + cached.count + (cached.count === 1 ? ' match' : ' matches') + '</span>';
    }
    var classes = SEL.stableClasses(el).slice(0, 3).map(function (c) {
      return '.' + c;
    }).join('');
    var id = el.id && el.id.indexOf('__scraperstack') === -1 ? '#' + el.id : '';
    positionTooltip(x, y, '<b>' + el.tagName.toLowerCase() + id + classes + '</b>' + detail);

    if (!cached) {
      scheduleSelectorPreview(el);
    }
  }

  function scheduleSelectorPreview(el) {
    clearTimeout(scheduleSelectorPreview.timer);
    scheduleSelectorPreview.timer = setTimeout(function () {
      if (state.picking && state.hovered === el) {
        getPreview(el);
        if (state.hovered === el) paintHighlight(el, state.hoverPoint ? state.hoverPoint.x : 0, state.hoverPoint ? state.hoverPoint.y : 0);
      }
    }, 90);
  }

  function getPreview(el) {
    var cached = state.selectorCache.get(el);
    if (cached) return cached;
    var info;
    if (state.picking && state.picking.kind === 'container') {
      var item = SEL.itemSelectorFor(el, document);
      info = { selector: item.selector, count: item.count };
    } else if (state.picking && state.picking.kind === 'field' && state.picking.container) {
      var rel = SEL.relativeSelector(el, state.picking.container, document);
      info = { selector: rel, count: countCoverage(state.picking.container, rel) };
    } else {
      var unique = SEL.uniqueSelector(el, document);
      info = { selector: unique, count: SEL.countMatches(unique, document) };
    }
    state.selectorCache.set(el, info);
    return info;
  }

  function countCoverage(containerSelector, fieldSelector) {
    var items = qsa(document, containerSelector);
    if (!items.length) return 0;
    var hit = 0;
    for (var i = 0; i < items.length; i += 1) {
      try {
        if (fieldSelector === ':self' || items[i].querySelector(fieldSelector)) hit += 1;
      } catch (err) {
        /* ignore */
      }
    }
    return hit;
  }

  function onPickerMove(event) {
    if (!state.picking) return;
    state.hoverPoint = { x: event.clientX, y: event.clientY };
    var el = document.elementFromPoint(event.clientX, event.clientY);
    if (isOurNode(el)) return;
    if (!el || el.nodeType !== 1) {
      state.hovered = null;
      paintHighlight(null);
      return;
    }
    if (el !== state.hovered) {
      state.hovered = el;
    }
    paintHighlight(el, event.clientX, event.clientY);
  }

  function onPickerOver(event) {
    if (!state.picking) return;
    if (!event.composedPath().includes(state.host)) event.preventDefault();
  }

  function onPickerClick(event) {
    if (!state.picking) return;
    if (event.composedPath().includes(state.host)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    var el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || isOurNode(el)) return;
    finishPick(el);
  }

  function onPickerKey(event) {
    if (!state.picking) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelPicking();
    }
  }

  function startPicking(options) {
    ensureOverlay();
    cancelPicking(true);
    state.picking = {
      kind: options.kind || 'field',
      fieldId: options.fieldId || '',
      container: options.container || '',
      mode: options.mode || ''
    };
    state.hovered = null;
    state.selectorCache = new WeakMap();
    setCursorMode(true);
    state.overlay.hud.hidden = false;
    state.overlay.hudMode.textContent =
      state.picking.kind === 'container'
        ? 'click one item of the repeating list'
        : state.picking.kind === 'next'
          ? 'click the next-page control'
          : 'click the field you want to capture';
    document.addEventListener('mousemove', onPickerMove, true);
    document.addEventListener('mouseover', onPickerOver, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKey, true);
    window.addEventListener('scroll', onPickerScroll, true);
    window.addEventListener('resize', onPickerScroll, true);
  }

  function onPickerScroll() {
    if (!state.picking) return;
    if (state.hoverPoint) {
      var el = document.elementFromPoint(state.hoverPoint.x, state.hoverPoint.y);
      if (!isOurNode(el)) {
        state.hovered = el;
        paintHighlight(el, state.hoverPoint.x, state.hoverPoint.y);
      }
    }
  }

  function stopPicking() {
    state.picking = null;
    state.hovered = null;
    setCursorMode(false);
    document.removeEventListener('mousemove', onPickerMove, true);
    document.removeEventListener('mouseover', onPickerOver, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    window.removeEventListener('scroll', onPickerScroll, true);
    window.removeEventListener('resize', onPickerScroll, true);
    if (state.overlay) {
      state.overlay.hl.classList.remove('on');
      state.overlay.tooltip.classList.remove('on');
      state.overlay.hud.hidden = true;
    }
  }

  function cancelPicking(quiet) {
    if (!state.picking) return;
    var info = state.picking;
    stopPicking();
    if (!quiet) post(MSG.PICK_CANCELLED, { kind: info.kind, fieldId: info.fieldId });
  }

  function finishPick(el) {
    var info = getPreview(el);
    var picking = state.picking;
    stopPicking();

    var payload = {
      kind: picking.kind,
      fieldId: picking.fieldId,
      selector: info.selector,
      count: info.count,
      tag: el.tagName.toLowerCase(),
      label: (SEL.previewText(el) || '').slice(0, 90),
      suggestedName: SEL.fieldNameFor(el)
    };

    if (picking.kind === 'container') {
      var items = qsa(document, info.selector);
      var fields = [];
      if (items.length) {
        fields = SEL.suggestFields(items[0], info.selector, document);
      }
      payload.count = items.length;
      payload.fields = fields;
      payload.sample = items[0] ? SEL.previewText(items[0]).slice(0, 140) : '';
      flashMatches(info.selector);
    }

    if (picking.kind === 'field' && picking.container) {
      payload.coverage = countCoverage(picking.container, info.selector);
      flashMatches(picking.container);
    }

    post(MSG.PICK_RESULT, payload);
    toast(
      picking.kind === 'container'
        ? 'List found · <b>' + payload.count + '</b> items'
        : 'Picked <b>' + escapeHtml(info.selector) + '</b>'
    );
  }

  function flashMatches(selector) {
    ensureOverlay();
    var layer = state.overlay.layer;
    Array.prototype.slice.call(layer.children).forEach(function (child) {
      child.remove();
    });
    var matches = qsa(document, selector).slice(0, 120);
    matches.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'flash';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.width = Math.max(0, rect.width) + 'px';
      box.style.height = Math.max(0, rect.height) + 'px';
      layer.appendChild(box);
    });
    if (state.flashTimer) clearTimeout(state.flashTimer);
    state.flashTimer = setTimeout(function () {
      Array.prototype.slice.call(layer.children).forEach(function (child) {
        child.remove();
      });
    }, 1400);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------- run engine */

  function firstFieldSelector(recipe) {
    var field = (recipe.fields || []).find(function (f) {
      return f && f.selector && f.selector !== ':self';
    });
    return field ? field.selector : '';
  }

  function itemSignature(recipe) {
    var selector = recipe.mode === 'list' ? recipe.containerSelector : firstFieldSelector(recipe);
    var nodes = qsa(document, selector);
    var first = nodes[0];
    return nodes.length + '|' + (first ? SEL.previewText(first).slice(0, 120) : '');
  }

  async function waitForItems(recipe, timeoutMs) {
    var selector = recipe.mode === 'list' ? recipe.containerSelector : firstFieldSelector(recipe);
    if (!selector) return;
    var deadline = Date.now() + clamp(timeoutMs || 4000, 500, 15000);
    while (Date.now() < deadline) {
      if (qsa(document, selector).length) return;
      await sleep(160);
    }
  }

  async function autoScroll(options) {
    var steps = clamp((options && options.steps) || 6, 1, 50);
    var delay = clamp((options && options.delayMs) || 650, 150, 5000);
    var started = Date.now();
    for (var i = 0; i < steps; i += 1) {
      var height = document.documentElement.scrollHeight;
      window.scrollTo(0, height);
      await sleep(delay);
      if (state.run && state.run.stopped) break;
      if (Date.now() - started > 30000) break;
      if (i >= 1 && document.documentElement.scrollHeight <= height && i > 2) break;
    }
    window.scrollTo(0, 0);
    await sleep(120);
  }

  function ingest(run, rows) {
    var added = 0;
    var dedupe = run.recipe.dedupe !== false;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var sig = EX.signature(row, run.fields);
      if (dedupe && run.seen.has(sig)) continue;
      run.seen.add(sig);
      run.rows.push(row);
      added += 1;
      if (run.rows.length >= run.limits.maxRows) {
        run.truncated = true;
        break;
      }
    }
    return added;
  }

  function progress(run, message, phase) {
    post(MSG.RUN_PROGRESS, {
      runId: run.runId,
      page: run.page,
      maxPages: run.maxPages,
      rowCount: run.rows.length,
      message: message,
      phase: phase || 'running',
      rows: EX.previewRows(run.rows, 25)
    });
  }

  function saveRunState(run, extra) {
    post(MSG.SET_RUN_STATE, Object.assign({
      runId: run.runId,
      origin: location.origin,
      url: location.href,
      recipe: run.recipe,
      rows: run.rows,
      page: run.page,
      maxPages: run.maxPages,
      startedAt: run.startedAt
    }, extra || {}));
  }

  function nextControl(selector) {
    var nodes = qsa(document, selector);
    for (var i = 0; i < nodes.length; i += 1) {
      if (!isDisabled(nodes[i])) return nodes[i];
    }
    return nodes[0] || null;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute && (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null)) return true;
    if (el.classList && (el.classList.contains('disabled') || el.classList.contains('is-disabled'))) return true;
    return false;
  }

  function linkFor(el) {
    if (!el) return '';
    var href = el.getAttribute && el.getAttribute('href');
    if (href) return href;
    var anchor = el.closest ? el.closest('a[href]') : null;
    return anchor ? anchor.getAttribute('href') : '';
  }

  function waitForPageChange(run, before) {
    var waitMs = clamp((run.recipe.pagination && run.recipe.pagination.waitMs) || 4000, 500, 15000);
    return new Promise(function (resolve) {
      var done = false;
      var timer = 0;
      var onPageHide = function () {
        finish({ kind: 'navigated' });
      };
      function cleanup() {
        clearInterval(timer);
        window.removeEventListener('pagehide', onPageHide);
      }
      function finish(value) {
        if (done) return;
        done = true;
        cleanup();
        resolve(value);
      }
      window.addEventListener('pagehide', onPageHide);
      var start = Date.now();
      timer = setInterval(function () {
        if (run.stopped) {
          finish({ kind: 'stopped' });
          return;
        }
        if (itemSignature(run.recipe) !== before) {
          setTimeout(function () {
            finish({ kind: 'inplace' });
          }, 240);
          clearInterval(timer);
          return;
        }
        if (Date.now() - start > waitMs) finish({ kind: 'timeout' });
      }, 150);
    });
  }

  async function advancePage(run) {
    var pagination = run.recipe.pagination || {};
    var mode = pagination.mode || 'click';
    var el = nextControl(pagination.nextSelector || '');

    if (mode === 'scroll') {
      await autoScroll(pagination);
      return { kind: 'inplace' };
    }

    if (!el) {
      return { kind: 'stop', reason: 'No next control matched "' + (pagination.nextSelector || '') + '".' };
    }
    if (isDisabled(el)) {
      return { kind: 'stop', reason: 'Reached the last page.' };
    }

    if (mode === 'url') {
      var href = linkFor(el);
      if (!href) return { kind: 'stop', reason: 'Next control has no link to follow.' };
      var url;
      try {
        url = new URL(href, location.href);
      } catch (err) {
        return { kind: 'stop', reason: 'Next link is not a valid URL.' };
      }
      if (url.origin !== location.origin) {
        return { kind: 'stop', reason: 'Next link leaves this site; stopping for safety.' };
      }
      var response = await fetch(url.href, { credentials: 'include' });
      if (!response.ok) {
        return { kind: 'stop', reason: 'Next page returned HTTP ' + response.status + '.' };
      }
      var html = await response.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var result = EX.extractPage(run.recipe, doc, url.href, run.limits);
      if (result.error) return { kind: 'stop', reason: result.error };
      return { kind: 'fetched', rows: result.rows };
    }

    var before = itemSignature(run.recipe);
    saveRunState(run, { page: run.page + 1, awaitingNavigation: true, expiresAt: Date.now() + 120000 });
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    await sleep(140);
    try {
      el.click();
    } catch (err) {
      return { kind: 'stop', reason: 'Could not click the next control.' };
    }
    var outcome = await waitForPageChange(run, before);
    if (outcome.kind === 'navigated') {
      return { kind: 'navigated' };
    }
    if (outcome.kind === 'timeout') {
      return { kind: 'stop', reason: 'Page did not change after clicking next.' };
    }
    if (outcome.kind === 'stopped') {
      return { kind: 'stopped' };
    }
    await sleep(clamp(pagination.settleMs || 260, 0, 4000));
    return { kind: 'inplace' };
  }

  function datasetPayload(run) {
    return {
      runId: run.runId,
      recipeId: (run.recipe && run.recipe.id) || '',
      recipeName: (run.recipe && run.recipe.name) || 'Untitled scrape',
      url: location.href,
      origin: location.origin,
      mode: (run.recipe && run.recipe.mode) || 'list',
      fields: run.fields.map(function (field) {
        return field.name;
      }),
      rows: run.rows,
      rowCount: run.rows.length,
      pages: run.page,
      durationMs: Date.now() - run.startedAt,
      truncated: !!run.truncated,
      createdAt: Date.now()
    };
  }

  async function savePartial(run) {
    if (!run.rows || !run.rows.length) return null;
    return postAwait(MSG.SAVE_DATASET, datasetPayload(run));
  }

  async function completeRun(run) {
    var durationMs = Date.now() - run.startedAt;
    var response = await postAwait(MSG.SAVE_DATASET, datasetPayload(run));

    post(MSG.RUN_DONE, {
      runId: run.runId,
      datasetId: response && response.datasetId ? response.datasetId : '',
      rowCount: run.rows.length,
      pages: run.page,
      durationMs: durationMs,
      truncated: !!run.truncated,
      rows: EX.previewRows(run.rows, 40)
    });
    post(MSG.CLEAR_RUN_STATE, { runId: run.runId });
    state.run = null;
    toast('Scrape complete · <b>' + run.rows.length + '</b> rows in ' + run.page + (run.page === 1 ? ' page' : ' pages'));
  }

  async function failRun(run, message) {
    var saved = await savePartial(run);
    post(MSG.RUN_ERROR, {
      runId: run.runId,
      datasetId: saved && saved.datasetId ? saved.datasetId : '',
      message: message || 'Scrape failed.'
    });
    post(MSG.CLEAR_RUN_STATE, { runId: run.runId });
    state.run = null;
    toast('Scrape stopped · <b>' + escapeHtml(message || 'Unknown error') + '</b>' +
      (saved && saved.datasetId ? ' · saved ' + run.rows.length + ' rows' : ''));
  }

  async function runScrape(recipe, runId, resume) {
    var settings = await getSettings();
    var maxRows = clamp(settings.maxRows || DEFAULTS.maxRows, 10, 10000);
    var pagination = recipe.pagination || {};
    var maxPages = pagination.enabled
      ? clamp(pagination.maxPages || settings.maxPages || 1, 1, (C.LIMITS && C.LIMITS.maxPaginationPages) || 50)
      : 1;

    var run = {
      runId: runId || 'run_' + Date.now().toString(36),
      recipe: recipe,
      fields: EX.usableFields(recipe),
      rows: (resume && resume.rows) || [],
      seen: new Set(),
      page: (resume && resume.page) || 1,
      startedAt: (resume && resume.startedAt) || Date.now(),
      stopped: false,
      maxPages: maxPages,
      truncated: false,
      limits: {
        maxRows: maxRows,
        includeEmptyRows: !!settings.includeEmptyRows
      }
    };
    run.rows.forEach(function (row) {
      run.seen.add(EX.signature(row, run.fields));
    });
    state.run = run;

    if (!run.fields.length) {
      await failRun(run, 'Add at least one field with a selector.');
      return;
    }

    try {
      progress(run, resume ? 'Resuming at page ' + run.page + '…' : 'Starting on page 1…', 'starting');
      if (!resume && recipe.scroll && recipe.scroll.enabled) {
        progress(run, 'Auto-scrolling to load content…', 'scrolling');
        await autoScroll(recipe.scroll);
      }

      var fetchedRows = null;
      while (true) {
        if (!fetchedRows) {
          await waitForItems(recipe, Math.max(4000, (settings.pageWaitMs || 1800) * 2));
        }
        var result = fetchedRows
          ? { rows: fetchedRows, error: '' }
          : EX.extractPage(recipe, document, location.href, run.limits);
        fetchedRows = null;

        if (result.error) throw new Error(result.error);
        var added = ingest(run, result.rows);
        progress(
          run,
          'Page ' + run.page + ' · ' + run.rows.length + ' rows collected',
          'collecting'
        );

        if (run.stopped) break;
        if (!pagination.enabled) break;
        if (run.page >= maxPages) break;
        if (run.rows.length >= run.limits.maxRows) {
          run.truncated = true;
          break;
        }
        var stopWhenNoNew = pagination.stopWhenNoNew !== false && settings.stopWhenNoNew !== false;
        if (stopWhenNoNew && run.page > 1 && added === 0) {
          progress(run, 'No new rows on the last page; stopping.', 'stopping');
          break;
        }

        progress(run, 'Waiting for page ' + (run.page + 1) + '…', 'advancing');
        saveRunState(run, { page: run.page + 1, awaitingNavigation: true, expiresAt: Date.now() + 120000 });
        var advance = await advancePage(run);

        if (advance.kind === 'navigated') {
          progress(run, 'Loading page ' + (run.page + 1) + '…', 'waiting');
          return;
        }
        if (advance.kind === 'stop') {
          progress(run, advance.reason, 'stopping');
          break;
        }
        if (advance.kind === 'stopped') break;
        if (advance.rows) fetchedRows = advance.rows;
        run.page += 1;
        saveRunState(run, { page: run.page, awaitingNavigation: false, expiresAt: Date.now() + 120000 });
        await sleep(clamp(pagination.delayMs !== undefined ? pagination.delayMs : (settings.pageDelayMs || 1000), 0, 8000));
      }

      await completeRun(run);
    } catch (err) {
      await failRun(run, err && err.message ? err.message : String(err));
    }
  }

  async function resumeFrom(pending) {
    if (!pending || !pending.recipe) return;
    if (state.run) return;
    if (pending.origin && pending.origin !== location.origin) {
      post(MSG.CLEAR_RUN_STATE, { runId: pending.runId });
      return;
    }
    if (pending.expiresAt && Date.now() > pending.expiresAt) {
      post(MSG.CLEAR_RUN_STATE, { runId: pending.runId });
      return;
    }
    var selector = pending.recipe.mode === 'list' ? pending.recipe.containerSelector : firstFieldSelector(pending.recipe);
    if (selector) {
      var deadline = Date.now() + 8000;
      while (Date.now() < deadline && !qsa(document, selector).length) {
        await sleep(200);
      }
      if (!qsa(document, selector).length) {
        var partial = {
          runId: pending.runId,
          recipe: pending.recipe,
          fields: EX.usableFields(pending.recipe),
          rows: pending.rows || [],
          page: Math.max(1, (pending.page || 2) - 1),
          startedAt: pending.startedAt || Date.now(),
          truncated: false
        };
        var saved = await savePartial(partial);
        post(MSG.RUN_ERROR, {
          runId: pending.runId,
          datasetId: saved && saved.datasetId ? saved.datasetId : '',
          message: 'Could not find the list on this page, so the resume was cancelled.' +
            (saved && saved.datasetId ? ' Saved ' + partial.rows.length + ' rows from earlier pages.' : '')
        });
        post(MSG.CLEAR_RUN_STATE, { runId: pending.runId });
        return;
      }
    }
    toast('Resuming scrape at page <b>' + (pending.page || 2) + '</b>');
    runScrape(pending.recipe, pending.runId, {
      rows: pending.rows || [],
      page: pending.page || 2,
      startedAt: pending.startedAt || Date.now()
    });
  }

  /* ------------------------------------------------------------- messages */

  function onMessage(message, sender, sendResponse) {
    var msg = message || {};
    var type = msg.type;
    var payload = msg.payload || {};

    try {
      switch (type) {
        case MSG.PING:
          sendResponse({
            ok: true,
            url: location.href,
            title: document.title,
            picking: !!state.picking,
            running: !!state.run
          });
          return false;

        case MSG.PICK:
          startPicking(payload);
          sendResponse({ ok: true });
          return false;

        case MSG.CANCEL_PICK:
          cancelPicking();
          sendResponse({ ok: true });
          return false;

        case MSG.RUN:
          if (state.run) {
            sendResponse({ ok: false, error: 'A scrape is already running on this page.' });
            return false;
          }
          runScrape(payload.recipe, payload.runId, null);
          sendResponse({ ok: true });
          return false;

        case MSG.STOP:
          if (state.run) {
            state.run.stopped = true;
            progress(state.run, 'Stopping…', 'stopping');
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'No scrape is running.' });
          }
          return false;

        case MSG.SUGGEST_ITEMS:
          sendResponse({ ok: true, items: SEL.suggestItemContainers(document) });
          return false;

        case MSG.SUGGEST_FIELDS: {
          var items = qsa(document, payload.selector || '');
          var fields = items.length ? SEL.suggestFields(items[0], payload.selector, document) : [];
          sendResponse({ ok: true, fields: fields, count: items.length });
          return false;
        }

        case MSG.COUNT:
          sendResponse({ ok: true, count: SEL.countMatches(payload.selector || '', document) });
          return false;

        case MSG.PREVIEW: {
          var recipe = payload.recipe || {};
          var preview = EX.extractPage(recipe, document, location.href, {
            maxRows: 50,
            includeEmptyRows: true
          });
          sendResponse({ ok: true, preview: preview });
          return false;
        }

        case MSG.CONTENT_READY: {
          (async function () {
            var response = await postAwait(MSG.GET_RUN_STATE, { url: location.href });
            sendResponse({ ok: true, resume: response && response.run ? response.run : null });
          })();
          return true;
        }

        default:
          return false;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      return false;
    }
  }

  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(onMessage);
  }

  async function bootstrap() {
    var response = await postAwait(MSG.CONTENT_READY, { url: location.href });
    if (response && response.resume) {
      resumeFrom(response.resume);
    }
  }

  window.addEventListener('pageshow', function (event) {
    if (event.persisted && !state.run) bootstrap();
  });

  bootstrap();
})();
