/*
 * Export button with the three save tiers (task 0.6).
 *  1. Opened from the local save server (http://127.0.0.1:<port>/#token=...): POST the files; the server writes design/.
 *  2. Always: publish the result where an agent's browser tools can read it:
 *       window.hawiyaExport (object), <script type="application/json" id="hawiya-export">, html[data-hawiya-export="ready"].
 *  3. Always: "Copy for the agent" (text for the chat) and one download button per file.
 * If tier 1 fails for any reason, tiers 2 and 3 are already on screen and the choices are untouched.
 */
(function () {
  'use strict';

  var H = window.Hawiya;
  var els = {};
  var current = null; // { files, bundle, text } of the last export, null once a choice changes
  var savedByServer = false;
  var inFlight = null; // the bundle currently being sent to the server, if any
  var uncertain = false; // a save failed without an HTTP answer: it may still land on disk, so never send another
  var SAVE_TIMEOUT_MS = 20000;

  var t = H.i18n.t;

  /*
   * Messages are i18n keys (picker/i18n/, prefix "export."). A shown message is kept as its parts
   * ([key, params] pairs) so a language switch redraws it in the new language.
   */
  var shown = { status: null, tone: 'info', copy: null };

  function text(parts) {
    return parts
      .map(function (p) {
        var params = p[1];
        if (params && params.names) {
          params = { names: params.names.join(t('export.listSeparator')) };
        }
        return t('export.' + p[0], params);
      })
      .join(' ');
  }

  /* Token only when served by our local server; it lives in the URL fragment, never sent over the network. */
  function serverToken() {
    if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null;
    var t = new URLSearchParams(location.hash.slice(1)).get('token');
    return t && /^[A-Za-z0-9_-]{20,256}$/.test(t) ? t : null;
  }

  function setStatus(parts, tone) {
    shown.status = parts;
    shown.tone = tone || 'info';
    els.status.textContent = text(parts);
    els.status.setAttribute('data-tone', shown.tone);
  }

  function setCopyStatus(parts) {
    shown.copy = parts;
    els.copyStatus.textContent = parts ? text(parts) : '';
  }

  function relabel() {
    if (shown.status) els.status.textContent = text(shown.status);
    if (shown.copy) els.copyStatus.textContent = text(shown.copy);
    Array.prototype.forEach.call(els.downloads.querySelectorAll('button[data-file]'), function (b) {
      b.textContent = t('export.download', { name: b.getAttribute('data-file') });
    });
  }

  /* ---------- tier 2: publish for agents ---------- */

  function publish(bundle) {
    window.hawiyaExport = bundle;
    var node = document.getElementById('hawiya-export');
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/json';
      node.id = 'hawiya-export';
      document.body.appendChild(node);
    }
    node.textContent = JSON.stringify(bundle).replace(/</g, '\\u003c');
    document.documentElement.setAttribute('data-hawiya-export', 'ready');
  }

  function unpublish() {
    window.hawiyaExport = null;
    var node = document.getElementById('hawiya-export');
    if (node) node.parentNode.removeChild(node);
    if (document.documentElement.hasAttribute('data-hawiya-export')) {
      document.documentElement.setAttribute('data-hawiya-export', 'stale');
    }
  }

  /* ---------- tier 3: copy and download ---------- */

  function buildDownloads(files) {
    els.downloads.textContent = '';
    Object.keys(files).forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary-btn';
      b.setAttribute('data-file', name);
      b.textContent = t('export.download', { name: name });
      b.addEventListener('click', function () {
        var type = /\.json$/.test(name) ? 'application/json' : /\.html$/.test(name) ? 'text/html' : 'text/markdown';
        var url = URL.createObjectURL(new Blob([files[name]], { type: type + ';charset=utf-8' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 10000);
      });
      els.downloads.appendChild(b);
    });
  }

  function showManualCopy(text) {
    els.fallback.value = text;
    els.fallback.hidden = false;
    els.fallback.focus();
    els.fallback.select();
    setCopyStatus([['copyManual']]);
  }

  function onCopy() {
    if (!current) return;
    var text = current.text;
    setCopyStatus(null);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(
        function () {
          els.fallback.hidden = true;
          setCopyStatus([['copied']]);
        },
        function () {
          showManualCopy(text);
        }
      );
    } else {
      showManualCopy(text);
    }
  }

  /* ---------- tier 1: save through the local server ---------- */

  /* Sends `bundle`; the outcome is shown even if the choices changed meanwhile (the panel stays visible). */
  function saveToServer(token, bundle) {
    setStatus([['saving']], 'info');
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, SAVE_TIMEOUT_MS);
    // Compare contents, not objects: exporting twice with the same choices is still "current".
    var sentKey = JSON.stringify(bundle.files);
    var stillCurrent = function () {
      return current !== null && JSON.stringify(current.bundle.files) === sentKey;
    };
    // A failure message that points at copy/download must not do so while those buttons are hidden.
    var warn = function (part) {
      setStatus(current === null ? [part, ['pressExportFirst']] : [part], 'warn');
    };

    return fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hawiya-Token': token },
      body: JSON.stringify({ files: bundle.files }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller ? controller.signal : undefined
    })
      .then(
        function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              els.result.hidden = false;
              if (res.status === 200 && data && Array.isArray(data.written)) {
                savedByServer = true;
                if (stillCurrent()) setStatus([['saved', { names: data.written }]], 'ok');
                else setStatus([['savedOlder', { names: data.written }]], 'warn'); // already says to press export
              } else if (res.status === 409) {
                warn(data && Array.isArray(data.existing) ? ['exists'] : ['notFolder']);
              } else if (res.status === 401) {
                warn(['badToken']);
              } else {
                warn(['failed', { status: res.status }]);
              }
            });
        },
        function () {
          // No HTTP answer: the server may still have written (or still write) this bundle.
          uncertain = true;
          els.result.hidden = false;
          warn(timedOut ? ['timeout'] : ['unreachable']);
        }
      )
      .then(function () {
        clearTimeout(timer);
      });
  }

  /* ---------- export ---------- */

  function onExport() {
    var files;
    try {
      files = H.generate(H.getGeneratorInput());
      current = { files: files, bundle: H.exportFormat.bundle(files), text: H.exportFormat.agentText(files) };
    } catch (e) {
      current = null;
      unpublish();
      els.actions.hidden = true;
      els.fallback.hidden = true;
      els.result.hidden = false;
      setStatus([['generateFailed']], 'warn');
      return;
    }

    // Tiers 2 and 3 first: whatever happens to the server, the result is already reachable.
    publish(current.bundle);
    buildDownloads(files);
    els.actions.hidden = false;
    els.fallback.hidden = true;
    setCopyStatus(null);
    els.result.hidden = false;

    var token = serverToken();
    if (!token) return setStatus([['fileMode']], 'info');
    if (savedByServer) return setStatus([['alreadySaved']], 'warn');
    if (uncertain) return setStatus([['uncertain']], 'warn');
    // Never block the button: while an earlier save is pending, copy/download still serve the current choices.
    if (inFlight) return setStatus([['previousPending']], 'warn');

    var sent = current.bundle;
    inFlight = sent;
    saveToServer(token, sent).then(function () {
      if (inFlight === sent) inFlight = null;
    });
  }

  /*
   * A changed choice makes the last export stale: withdraw it (tier 2) and its copy/download buttons (tier 3)
   * so nobody uses an old result. The status line stays visible, so the outcome of a pending save is still seen.
   */
  function onChange() {
    if (!current) return;
    current = null;
    unpublish();
    els.actions.hidden = true;
    els.fallback.hidden = true;
    setCopyStatus(null);
    if (inFlight) setStatus([['changedDuringSave']], 'warn');
    else setStatus([['changed']], 'info');
  }

  function init() {
    els.button = document.getElementById('export-btn');
    els.result = document.getElementById('export-result');
    els.status = document.getElementById('export-status');
    els.copy = document.getElementById('copy-btn');
    els.actions = document.getElementById('export-actions');
    els.downloads = document.getElementById('download-list');
    els.copyStatus = document.getElementById('copy-status');
    els.fallback = document.getElementById('copy-fallback');
    els.button.addEventListener('click', onExport);
    els.copy.addEventListener('click', onCopy);
    document.addEventListener('hawiya:change', onChange);
    document.addEventListener('hawiya:lang', relabel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
