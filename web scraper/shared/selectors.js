/* scraperStack · selector engine
 * Builds stable CSS selectors for a picked element, generalises an element to
 * the repeating group it belongs to, and finds selectors relative to list items.
 *
 * Exposed as window.SSSelectors for the content script (and for the demo page
 * self-test, which loads this file directly).
 */
(function (root) {
  'use strict';

  var ATTR_CANDIDATES = [
    'data-testid',
    'data-test',
    'data-qa',
    'data-cy',
    'data-field',
    'itemprop',
    'name',
    'aria-label',
    'title',
    'alt'
  ];

  var HASH_CLASS = /(?:^|[-_])[a-f0-9]{6,}(?:$|[-_])/i;
  var STATE_CLASS = /^(?:is-|has-)[a-z-]+$/i;
  var STATE_WORD = /^(?:active|selected|disabled|open|closed|hidden|visible|show|hover|focus|loading)$/i;
  var GENERATED = /^(?:ember|react|radix|mui|rc|headlessui|downshift|base-ui)[-_]?\d+/i;
  var UTILITY_CLASS = /^(?:css|sc|jsx|svelte|emotion|tw)-[a-z0-9-]+$/i;

  function tagName(el) {
    return el && el.tagName ? el.tagName.toLowerCase() : '';
  }

  function cssEscape(value) {
    var v = String(value == null ? '' : value);
    if (root.CSS && typeof root.CSS.escape === 'function') return root.CSS.escape(v);
    return v.replace(/([^\w-])/g, '\\$1');
  }

  function escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  function qsa(scope, selector) {
    if (!scope || !selector) return [];
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function isUnique(selector, el, doc) {
    try {
      var list = doc.querySelectorAll(selector);
      return list.length === 1 && list[0] === el;
    } catch (err) {
      return false;
    }
  }

  function isValidSelector(selector, doc) {
    if (!selector || selector.length > 400) return false;
    try {
      (doc || root.document).createDocumentFragment().querySelector(selector);
      (doc || root.document).querySelectorAll(selector);
      return true;
    } catch (err) {
      return false;
    }
  }

  function stableClasses(el) {
    if (!el || !el.classList) return [];
    var out = [];
    for (var i = 0; i < el.classList.length; i += 1) {
      var c = el.classList[i];
      if (!c || c.length > 48) continue;
      if (/^\d/.test(c)) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(c)) continue;
      if (HASH_CLASS.test(c)) continue;
      if (STATE_CLASS.test(c) || STATE_WORD.test(c)) continue;
      if (UTILITY_CLASS.test(c) && /\d/.test(c)) continue;
      out.push(c);
    }
    return out;
  }

  function isStableValue(value) {
    if (!value) return false;
    var v = String(value).trim();
    if (v.length < 2 || v.length > 80) return false;
    if (/[\r\n\t]/.test(v)) return false;
    if (/^[\d.,:%\s-]+$/.test(v)) return false;
    if (GENERATED.test(v)) return false;
    if (/^[a-f0-9]{16,}$/i.test(v)) return false;
    return true;
  }

  function isStableId(value) {
    if (!value) return false;
    var v = String(value);
    if (v.length > 70) return false;
    if (/^\d+$/.test(v)) return false;
    if (/\d{5,}/.test(v)) return false;
    if (GENERATED.test(v)) return false;
    if (/^(?::|ember\d|react-|radix-|mui-|rc-)/i.test(v)) return false;
    return true;
  }

  function duplicateCount(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var same = 0;
    for (var i = 0; i < parent.children.length; i += 1) {
      var c = parent.children[i];
      if (c.tagName !== el.tagName) continue;
      if (c === el) same += 1;
      else if (stableClasses(c)[0] && stableClasses(c)[0] === stableClasses(el)[0]) same += 1;
    }
    return same;
  }

  function segment(el, forceNth) {
    var t = tagName(el);
    if (!t) return '';
    var classes = stableClasses(el);
    var sameClasses = classes.length ? classes[0] : '';
    var s = t + (sameClasses ? '.' + cssEscape(sameClasses) : '');
    var parent = el.parentElement;
    if (parent && forceNth !== false) {
      var siblings = Array.prototype.slice.call(parent.children);
      var dupes = siblings.filter(function (c) {
        if (c.tagName !== el.tagName) return false;
        if (!sameClasses) return true;
        return c.classList && c.classList.contains(sameClasses);
      });
      if (forceNth === true || dupes.length > 1) {
        var sameTag = siblings.filter(function (c) {
          return c.tagName === el.tagName;
        });
        var index = sameTag.indexOf(el);
        if (index > -1) s += ':nth-of-type(' + (index + 1) + ')';
      }
    }
    return s;
  }

  function anchorSelector(el) {
    if (!el || !el.getAttribute) return '';
    var id = el.getAttribute('id');
    if (id && isStableId(id)) return '#' + cssEscape(id);
    for (var i = 0; i < ATTR_CANDIDATES.length; i += 1) {
      var attr = ATTR_CANDIDATES[i];
      var v = el.getAttribute(attr);
      if (v && isStableValue(v)) {
        return tagName(el) + '[' + attr + '="' + escAttr(v) + '"]';
      }
    }
    var classes = stableClasses(el).slice(0, 2);
    if (classes.length) {
      return tagName(el) + classes.map(function (c) {
        return '.' + cssEscape(c);
      }).join('');
    }
    return '';
  }

  function uniqueSelector(el, doc) {
    if (!el || el.nodeType !== 1) return '';
    doc = doc || el.ownerDocument || root.document;
    if (!doc || !doc.documentElement) return '';
    if (el === doc.documentElement) return 'html';
    if (el === doc.body) return 'body';

    var id = el.getAttribute('id');
    if (id && isStableId(id)) {
      var idSel = '#' + cssEscape(id);
      if (isUnique(idSel, el, doc)) return idSel;
    }

    var t = tagName(el);
    for (var i = 0; i < ATTR_CANDIDATES.length; i += 1) {
      var attr = ATTR_CANDIDATES[i];
      var v = el.getAttribute(attr);
      if (!v || v.length > 80) continue;
      if (attr !== 'name' && !isStableValue(v)) continue;
      if (attr === 'name' && !/^[\w:[\]-]{2,80}$/.test(v)) continue;
      var attrSel = t + '[' + attr + '="' + escAttr(v) + '"]';
      if (isUnique(attrSel, el, doc)) return attrSel;
    }

    var classes = stableClasses(el);
    if (classes.length) {
      var combos = [classes.slice(0, 2), classes.slice(0, 1)];
      for (var c = 0; c < combos.length; c += 1) {
        if (!combos[c].length) continue;
        var classSel = t + combos[c].map(function (name) {
          return '.' + cssEscape(name);
        }).join('');
        if (isUnique(classSel, el, doc)) return classSel;
      }
    }

    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && node !== doc.documentElement && guard < 48) {
      guard += 1;
      parts.unshift(segment(node));
      var rel = parts.join(' > ');
      var parent = node.parentElement;
      if (parent && parent !== doc.documentElement) {
        var anchor = anchorSelector(parent);
        if (anchor) {
          var cand = anchor + ' > ' + rel;
          if (isUnique(cand, el, doc)) return cand;
        }
      }
      node = parent;
    }

    var full = parts.join(' > ');
    if (full && isUnique(full, el, doc)) return full;
    if (full) return full;
    return t;
  }

  function countMatches(selector, doc) {
    if (!isValidSelector(selector, doc)) return 0;
    return qsa(doc || root.document, selector).length;
  }

  /* A generalised selector for the repeating group an element belongs to. */
  function itemSelectorFor(el, doc) {
    if (!el || el.nodeType !== 1) return { selector: '', count: 0 };
    doc = doc || el.ownerDocument || root.document;
    var t = tagName(el);
    var classes = stableClasses(el);
    var parent = el.parentElement;
    var parentSel = parent ? uniqueSelector(parent, doc) : '';
    var candidates = [];

    if (parentSel && classes.length) {
      candidates.push(parentSel + ' > ' + t + '.' + cssEscape(classes[0]));
    }
    if (parentSel) candidates.push(parentSel + ' > ' + t);
    if (classes.length) {
      candidates.push(t + '.' + classes.slice(0, 2).map(function (c) {
        return cssEscape(c);
      }).join('.'));
      candidates.push(t + '.' + cssEscape(classes[0]));
    }
    candidates.push(t);

    var fallback = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var list = qsa(doc, candidates[i]);
      if (list.indexOf(el) === -1) continue;
      if (list.length >= 2) return { selector: candidates[i], count: list.length };
      if (!fallback) fallback = { selector: candidates[i], count: list.length };
    }
    if (fallback && fallback.count === 1) return fallback;
    var uniq = uniqueSelector(el, doc);
    return { selector: uniq, count: qsa(doc, uniq).length };
  }

  function relativePath(el, container) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node !== container && guard < 40) {
      guard += 1;
      parts.unshift(segment(node));
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  /* A selector for el that works inside every list item. */
  function relativeSelector(el, containerSelector, doc) {
    if (!el || el.nodeType !== 1) return '';
    doc = doc || el.ownerDocument || root.document;
    if (!containerSelector) return uniqueSelector(el, doc);

    var container = null;
    try {
      container = el.closest(containerSelector);
    } catch (err) {
      container = null;
    }
    if (!container) return uniqueSelector(el, doc);
    if (container === el) return ':self';

    var containers = qsa(doc, containerSelector);
    if (!containers.length) return uniqueSelector(el, doc);
    var ownIndex = containers.indexOf(container);
    if (ownIndex === -1) return uniqueSelector(el, doc);

    var t = tagName(el);
    var classes = stableClasses(el);
    var candidates = [];

    ['data-testid', 'itemprop', 'name', 'aria-label', 'alt'].forEach(function (attr) {
      var v = el.getAttribute(attr);
      if (v && isStableValue(v)) candidates.push(t + '[' + attr + '="' + escAttr(v) + '"]');
    });

    if (classes.length > 1) {
      candidates.push(t + '.' + classes.slice(0, 2).map(function (c) {
        return cssEscape(c);
      }).join('.'));
    }
    if (classes.length) candidates.push(t + '.' + cssEscape(classes[0]));

    var path = relativePath(el, container);
    if (path) candidates.push(path);
    candidates.push(t);

    var best = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      if (!candidate) continue;
      var matched = 0;
      var extras = 0;
      var ownHit = false;
      for (var j = 0; j < containers.length; j += 1) {
        var nodes = [];
        try {
          nodes = Array.prototype.slice.call(containers[j].querySelectorAll(candidate));
        } catch (err) {
          nodes = [];
        }
        if (nodes.length) matched += 1;
        extras += Math.max(0, nodes.length - 1);
        if (j === ownIndex && nodes.indexOf(el) !== -1) ownHit = true;
      }
      if (!ownHit) continue;
      var ratio = containers.length ? matched / containers.length : 0;
      var score = ratio * 100 - extras * 0.6 - candidate.length * 0.08;
      if (!best || score > best.score) {
        best = { selector: candidate, score: score, coverage: Math.round(ratio * 100) };
      }
    }
    return best ? best.selector : uniqueSelector(el, doc);
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.getBoundingClientRect) return true;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    if (!win) return true;
    var style = win.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    return true;
  }

  function previewText(el) {
    if (!el) return '';
    var text = el.innerText != null ? el.innerText : el.textContent;
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function humanize(value) {
    var v = String(value == null ? '' : value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!v) return '';
    v = v.replace(/[^\w\s&/']/g, '').trim();
    if (!v) return '';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  function fieldNameFor(el) {
    if (!el || !el.getAttribute) return 'Field';
    var labelled = el.getAttribute('data-field') || el.getAttribute('itemprop') || el.getAttribute('aria-label');
    if (labelled && labelled.length <= 40) return humanize(labelled);
    var classes = stableClasses(el);
    for (var i = classes.length - 1; i >= 0; i -= 1) {
      var name = humanize(classes[i]);
      if (name && name.length <= 30) return name;
    }
    var label = humanize(previewText(el).slice(0, 32));
    if (label) return label;
    return humanize(tagName(el)) || 'Field';
  }

  /* Rank likely repeated containers (product grids, result lists, tables). */
  function suggestItemContainers(doc) {
    doc = doc || root.document;
    if (!doc || !doc.body) return [];
    var started = Date.now();
    var found = new Map();
    var nodes = doc.body.querySelectorAll('*');

    for (var i = 0; i < nodes.length; i += 1) {
      if (Date.now() - started > 1800) break;
      var container = nodes[i];
      if (container.children.length < 3) continue;
      if (!visible(container)) continue;

      var groups = new Map();
      for (var c = 0; c < container.children.length; c += 1) {
        var child = container.children[c];
        if (!visible(child)) continue;
        var signature = tagName(child) + '|' + stableClasses(child).slice(0, 2).join('.');
        var group = groups.get(signature);
        if (!group) {
          group = [];
          groups.set(signature, group);
        }
        group.push(child);
      }

      var values = Array.from(groups.values());
      for (var g = 0; g < values.length; g += 1) {
        var items = values[g];
        if (items.length < 3) continue;
        var sample = items[0];
        var sampleText = previewText(sample);
        if (sampleText.length < 4) continue;

        var containerSelector = uniqueSelector(container, doc);
        if (!containerSelector) continue;
        var itemSelector = containerSelector + ' > ' + segment(sample, false);
        var count = countMatches(itemSelector, doc);
        if (count < 3 || count > 3000) continue;
        if (found.has(itemSelector)) continue;

        var score = Math.min(count, 40);
        score += sample.querySelector('img') ? 8 : 0;
        score += sample.querySelector('a[href]') ? 5 : 0;
        score += Math.min(sampleText.length / 25, 12);

        found.set(itemSelector, {
          selector: itemSelector,
          count: count,
          score: score,
          sample: sampleText.slice(0, 90)
        });
      }
    }

    return Array.from(found.values())
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 5);
  }

  /* Suggest fields for the first item of a list. */
  function suggestFields(item, itemSelector, doc) {
    if (!item) return [];
    doc = doc || item.ownerDocument || root.document;
    var items = qsa(doc, itemSelector);
    var out = [];

    function coverage(selector) {
      if (!items.length || !selector) return 0;
      var hit = 0;
      for (var i = 0; i < items.length; i += 1) {
        try {
          if (items[i].querySelector(selector)) hit += 1;
        } catch (err) {
          /* ignore */
        }
      }
      return Math.round((hit / items.length) * 100);
    }

    function add(name, el, kind, attribute) {
      if (!el) return;
      var selector = relativeSelector(el, itemSelector, doc);
      if (!selector) return;
      var exists = out.some(function (f) {
        return f.selector === selector && f.kind === kind;
      });
      if (exists) return;
      out.push({
        name: name,
        selector: selector,
        kind: kind,
        attribute: attribute || '',
        coverage: coverage(selector)
      });
    }

    add('Image', item.querySelector('img'), 'src');
    add('Link', item.querySelector('a[href]'), 'href');
    add('Title', item.querySelector('h1,h2,h3,h4,h5,h6'), 'text');

    var leafNodes = Array.prototype.slice.call(item.querySelectorAll('*')).filter(function (el) {
      return el.children.length === 0 && previewText(el).length > 0;
    });

    var priceNode = leafNodes.find(function (el) {
      return /(?:[$€£₹¥]\s?\d[\d.,]*)|(?:\d[\d.,]*\s?(?:USD|EUR|GBP|INR|JPY))/i.test(previewText(el));
    });
    add('Price', priceNode, 'text');

    var dateNode = item.querySelector('time[datetime], [datetime]');
    add('Date', dateNode, 'attribute', 'datetime');

    if (!out.some(function (f) { return f.name === 'Title'; })) {
      var longest = leafNodes.slice().sort(function (a, b) {
        return previewText(b).length - previewText(a).length;
      })[0];
      add('Text', longest, 'text');
    }

    return out.slice(0, 6);
  }

  root.SSSelectors = {
    uniqueSelector: uniqueSelector,
    itemSelectorFor: itemSelectorFor,
    relativeSelector: relativeSelector,
    suggestItemContainers: suggestItemContainers,
    suggestFields: suggestFields,
    isValidSelector: isValidSelector,
    countMatches: countMatches,
    fieldNameFor: fieldNameFor,
    stableClasses: stableClasses,
    previewText: previewText,
    humanize: humanize,
    visible: visible,
    qsa: qsa
  };
})(typeof window !== 'undefined' ? window : globalThis);
