/* scraperStack · extraction engine
 * Turns a recipe + a Document into rows of strings. Works on live pages and on
 * documents parsed from fetched HTML (where innerText and baseURI are absent).
 */
(function (root) {
  'use strict';

  function qsa(scope, selector) {
    if (!scope || !selector) return [];
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function rawText(node) {
    if (!node) return '';
    var value = node.innerText != null ? node.innerText : node.textContent;
    return value == null ? '' : String(value);
  }

  function absolute(value, baseUrl, ownerDoc) {
    if (!value) return '';
    var base = baseUrl || (ownerDoc && ownerDoc.baseURI) || (root.document && root.document.baseURI) || '';
    try {
      return new URL(value, base).href;
    } catch (err) {
      return value;
    }
  }

  function normalize(value, transform) {
    var t = transform || {};
    var out = value == null ? '' : String(value);
    if (t.trim !== false) out = out.trim();
    if (t.collapse !== false) out = out.replace(/\s+/g, ' ').trim();
    if (t.regex) {
      try {
        var re = new RegExp(t.regex, t.flags || 'g');
        var with_ = typeof t.replace === 'string' ? t.replace : '';
        out = out.replace(re, with_);
      } catch (err) {
        /* an invalid pattern is reported by the panel before a run */
      }
    }
    if (t.prefix) out = t.prefix + out;
    if (t.suffix) out = out + t.suffix;
    if (!out && t.fallback) out = t.fallback;
    return out.trim();
  }

  function readNode(node, field, baseUrl) {
    var kind = field.kind || 'text';
    var value = '';
    switch (kind) {
      case 'html':
        value = node.innerHTML == null ? '' : node.innerHTML;
        break;
      case 'outerHTML':
        value = node.outerHTML == null ? '' : node.outerHTML;
        break;
      case 'attribute':
        value = node.getAttribute ? node.getAttribute(field.attribute || 'href') : '';
        break;
      case 'href':
        value = absolute(node.getAttribute ? node.getAttribute('href') : '', baseUrl, node.ownerDocument);
        break;
      case 'src':
        value = absolute(
          (node.getAttribute && (node.getAttribute('src') || node.getAttribute('data-src'))) || '',
          baseUrl,
          node.ownerDocument
        );
        break;
      case 'value':
        value = node.value == null ? '' : node.value;
        break;
      case 'exists':
        value = 'true';
        break;
      case 'text':
      default:
        value = rawText(node);
        break;
    }
    return normalize(value, field.transform);
  }

  function extractRow(scope, fields, baseUrl) {
    var row = {};
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (!field || !field.name || !field.selector) continue;
      var value = '';

      if (field.kind === 'count') {
        value = field.selector === ':self' ? '1' : String(qsa(scope, field.selector).length);
      } else if (field.kind === 'exists') {
        value = (field.selector === ':self' || qsa(scope, field.selector).length) ? 'true' : 'false';
      } else if (field.selector === ':self') {
        value = readNode(scope, field, baseUrl);
      } else {
        var nodes = qsa(scope, field.selector);
        if (field.multiple) {
          var parts = [];
          for (var n = 0; n < nodes.length; n += 1) {
            var part = readNode(nodes[n], field, baseUrl);
            if (part !== '') parts.push(part);
          }
          value = parts.join(field.joinWith || ' | ');
        } else if (nodes.length) {
          value = readNode(nodes[0], field, baseUrl);
        }
      }
      row[field.name] = value == null ? '' : String(value);
    }
    return row;
  }

  function usableFields(recipe) {
    return (recipe && recipe.fields ? recipe.fields : []).filter(function (field) {
      return field && field.name && (field.selector === ':self' || field.selector);
    });
  }

  function rowIsBlank(row) {
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i += 1) {
      if (String(row[keys[i]] == null ? '' : row[keys[i]]).trim() !== '') return false;
    }
    return true;
  }

  function signature(row, fields) {
    return JSON.stringify(
      fields.map(function (field) {
        return String(row[field.name] == null ? '' : row[field.name]);
      })
    );
  }

  function extractPage(recipe, doc, baseUrl, limits) {
    doc = doc || root.document;
    var cap = Math.max(1, (limits && limits.maxRows) || 5000);
    var includeEmpty = !!(limits && limits.includeEmptyRows);
    var fields = usableFields(recipe);
    var rows = [];

    if (!recipe || !fields.length) {
      return { rows: [], fields: fields, containers: 0, error: 'Add at least one field before running.' };
    }

    if (recipe.mode === 'single') {
      var single = extractRow(doc, fields, baseUrl);
      if (!rowIsBlank(single) || includeEmpty) rows.push(single);
      return { rows: rows, fields: fields, containers: 1, error: '' };
    }

    if (!recipe.containerSelector) {
      return { rows: [], fields: fields, containers: 0, error: 'Pick a repeating item first.' };
    }

    var containers = qsa(doc, recipe.containerSelector);
    if (containers.length > cap) containers = containers.slice(0, cap);

    for (var i = 0; i < containers.length && rows.length < cap; i += 1) {
      var row = extractRow(containers[i], fields, baseUrl);
      if (!rowIsBlank(row) || includeEmpty) rows.push(row);
    }

    return { rows: rows, fields: fields, containers: containers.length, error: '' };
  }

  function previewRows(rows, limit) {
    var max = limit || 30;
    return rows.slice(0, max).map(function (row) {
      var copy = {};
      Object.keys(row).forEach(function (key) {
        copy[key] = String(row[key] == null ? '' : row[key]);
      });
      return copy;
    });
  }

  root.SSExtractor = {
    extractPage: extractPage,
    extractRow: extractRow,
    usableFields: usableFields,
    rowIsBlank: rowIsBlank,
    signature: signature,
    previewRows: previewRows,
    normalize: normalize,
    absolute: absolute
  };
})(typeof window !== 'undefined' ? window : globalThis);
