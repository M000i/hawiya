/*
 * The «Export» button with the three save tiers (task 2.21, R-012 / R-013 / R-014; plan.md section 6).
 * Browser: loads after state.js, bundle.js, zip.js and export-format.js.
 *
 * One press always does the same, in this order:
 *  - builds the export bundle from the current identity (bundle.build: the six files, each with its SHA-256) and
 *    checks it (bundle.verify); what is checked is exactly what is published, copied, zipped and sent;
 *  2. publishes it where an agent's browser tools can read it: window.hawiyaExport (the whole bundle),
 *     <script type="application/json" id="hawiya-export">, html[data-hawiya-export="ready"];
 *  3. shows «Copy for the agent» (instructions + the five text files) and «Download» (hawiya-design.zip with the
 *     six files in a design/ folder);
 *  1. when the page was opened from the local save server (http://127.0.0.1:<port>/#token=...), sends the bundle;
 *     the server checks it again and writes design/.
 * Tiers 2 and 3 are on screen before the server answers, so if saving fails the alternatives are already there
 * and the choices are untouched. If copying fails, the text is shown selected for copying by hand.
 * A page opened from the server without its token (an incomplete link) says so instead of «opened as a file».
 */
(function () {
  'use strict';

  var H = window.Hawiya;
  var els = {};
  var current = null; // { bundle, text, key } of the last export, null once the identity changes
  var savedByServer = false;
  var inFlight = null; // the bundle currently being sent to the server, if any
  var uncertain = false; // a save failed without an HTTP answer: it may still land on disk, so never send another
  var refused = false; // the server refused this page's token: never send again (a failed save counts toward closing)
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

  function fromServerHost() {
    return location.protocol === 'http:' && location.hostname === '127.0.0.1';
  }

  /* Token only when served by our local server; it lives in the URL fragment, never sent over the network. */
  function serverToken() {
    if (!fromServerHost()) return null;
    var parts = location.hash.replace(/^#/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      var m = /^token=([A-Za-z0-9_-]{20,256})$/.exec(parts[i]);
      if (m) return m[1];
    }
    return null;
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
    els.download.textContent = t('export.downloadZip');
  }

  /* ---------- tier 2: publish for agents ---------- */

  // Agents get their own copy: changing it cannot change what this page downloads or copies.
  function publish(bundle) {
    window.hawiyaExport = JSON.parse(JSON.stringify(bundle));
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

  function onDownload() {
    if (!current) return;
    var bytes;
    try {
      bytes = H.zip.designZip(current.bundle);
    } catch (e) {
      return setStatus([['downloadFailed']], 'warn');
    }
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = H.zip.FILE_NAME;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  function showManualCopy(value) {
    els.fallback.value = value;
    els.fallback.hidden = false;
    els.fallback.focus();
    els.fallback.select();
    setCopyStatus([['copyManual']]);
  }

  function onCopy() {
    if (!current) return;
    var value = current.text;
    setCopyStatus(null);
    var clip = navigator.clipboard;
    var copied;
    try {
      copied = clip && typeof clip.writeText === 'function' ? clip.writeText(value) : null;
    } catch (e) {
      copied = null;
    }
    if (!copied || typeof copied.then !== 'function') return showManualCopy(value);
    copied.then(
      function () {
        els.fallback.hidden = true;
        setCopyStatus([['copied']]);
      },
      function () {
        showManualCopy(value);
      }
    );
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
    // Compare contents with the identity on screen now (a choice changed and changed back is still current).
    var sentKey = JSON.stringify(bundle.files);
    var stillCurrent = function () {
      try {
        return JSON.stringify(H.bundle.build(H.state.identity()).files) === sentKey;
      } catch (e) {
        return false;
      }
    };
    // A failure message that points at copy/download must not do so while those buttons are hidden.
    var warn = function (part) {
      setStatus(current === null ? [part, ['pressExportFirst']] : [part], 'warn');
    };

    return fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hawiya-Token': token },
      body: JSON.stringify(bundle),
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
              return null;
            })
            .then(function (data) {
              els.result.hidden = false;
              if (res.status === 200 && !data) {
                // The server answered but its reply could not be read (e.g. the time limit hit mid-reply): it
                // may have saved. Never claim it did not, and never send again.
                uncertain = true;
                warn(timedOut ? ['timeout'] : ['unreachable']);
              } else if (res.status === 200 && Array.isArray(data.written)) {
                savedByServer = true;
                if (stillCurrent()) setStatus([['saved', { names: data.written }]], 'ok');
                else setStatus([['savedOlder', { names: data.written }]], 'warn'); // already says to press export
              } else if (res.status === 409) {
                warn(data && Array.isArray(data.existing) ? ['exists'] : ['notFolder']);
              } else if (res.status === 401) {
                refused = true;
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

  function identityKey() {
    return JSON.stringify(H.state.identity());
  }

  function onExport() {
    var bundle;
    try {
      bundle = H.bundle.build(H.state.identity());
      if (H.bundle.verify(bundle).length) throw new Error('the export bundle does not check');
      current = { bundle: bundle, text: H.exportFormat.agentText(bundle.files), key: identityKey() };
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
    els.actions.hidden = false;
    els.fallback.hidden = true;
    setCopyStatus(null);
    els.result.hidden = false;

    var token = serverToken();
    if (!token)
      return setStatus(fromServerHost() ? [['missingToken']] : [['fileMode']], fromServerHost() ? 'warn' : 'info');
    if (savedByServer) return setStatus([['alreadySaved']], 'warn');
    // A tab left from an earlier run (same fixed address, old token): saving would only use up the new run's
    // attempts, so it is never tried (CHG-1).
    if (refused || (H.sessionData && H.sessionData.linkRefused && H.sessionData.linkRefused())) {
      return setStatus([['staleLink']], 'warn');
    }
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
   * A changed identity makes the last export stale: withdraw it (tier 2) and its copy/download buttons (tier 3)
   * so nobody uses an old result. The status line stays visible, so the outcome of a pending save is still seen.
   */
  function onChange() {
    if (!current || identityKey() === current.key) return;
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
    els.download = document.getElementById('download-btn');
    els.actions = document.getElementById('export-actions');
    els.copyStatus = document.getElementById('copy-status');
    els.fallback = document.getElementById('copy-fallback');
    els.button.addEventListener('click', onExport);
    els.copy.addEventListener('click', onCopy);
    els.download.addEventListener('click', onDownload);
    document.addEventListener('hawiya:state', onChange);
    document.addEventListener('hawiya:lang', relabel);
  }

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
