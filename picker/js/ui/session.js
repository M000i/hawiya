/*
 * The session: what the agent detected about the project (task 2.20, R-033 / R-003; plan.md section 6, b and e).
 * Browser: window.Hawiya.sessionData, and window.Hawiya.session once one is read (load i18n.js, schemas.js and
 * validate.js first, and this file before the element parts and gallery.js). Node: require (tests).
 *
 * Where it comes from:
 *   - page opened from the local save server (http://127.0.0.1:<port>/#token=...): GET /api/session with the token;
 *     when the server has none (404) or cannot answer, the end of the link is tried next;
 *   - page opened as a file: the end of the link, #session=<the session JSON in UTF-8, base64 or base64url, with
 *     or without padding>
 *     (it may sit next to the token: #token=...&session=...).
 * Every session is checked against schema/session.schema.json (same keys twice refused too) before it is used.
 * Missing → the page runs on its defaults and says so; damaged (anything that does not pass) → the same, with a
 * warning. Its values only steer suggestions (tags, brand colors); no text from it is ever written into the page.
 *
 *   fromHash(hash)              → { status: 'ok' | 'none' | 'damaged', session (frozen) or null }
 *   fromServer(status, body)    → the same, from the server's reply (404 "no session" = none; a status other
 *                                 than 200 / 404 = 'unreachable': the link is used instead)
 *   encode(session)             → the text that goes after #session=
 * Browser events: 'hawiya:session' when a session read from the server arrives after the page has started.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var H = node ? null : (root.Hawiya = root.Hawiya || {});
  var validate = node ? require('../core/validate.js') : H.validate;
  if (!validate) throw new Error('Hawiya.sessionData: load validate.js first');
  var api = factory(validate);
  if (node) module.exports = api;
  else {
    H.sessionData = api;
    if (typeof document !== 'undefined') api.boot(root, H);
  }
})(typeof self !== 'undefined' ? self : this, function (validate) {
  'use strict';

  var MAX_LINK = 4096; // characters after #session= (a real session is a few hundred)
  var MAX_REPLY = 65536; // bytes of a server reply
  var NONE = { status: 'none', session: null };
  var DAMAGED = { status: 'damaged', session: null };
  var UNREACHABLE = { status: 'unreachable', session: null }; // no answer about a session (wrong token, no server)

  function freeze(x) {
    if (x && typeof x === 'object') {
      Object.keys(x).forEach(function (k) {
        freeze(x[k]);
      });
      Object.freeze(x);
    }
    return x;
  }

  // JSON text → a session, only when it passes the schema (and has no key twice).
  function fromText(text) {
    if (typeof text !== 'string' || !validate.checkText('session', text).valid) return DAMAGED;
    return { status: 'ok', session: freeze(JSON.parse(text)) };
  }

  function utf8(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  // base64url or plain base64, with or without the = padding (as any tool writes it), in one piece.
  function decode(value) {
    var bare = value.replace(/(=|%3D){1,2}$/i, '');
    if (!/^[A-Za-z0-9_+/-]+$/.test(bare) || bare.length % 4 === 1) return null;
    var b64 = bare.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return utf8(bytes);
    } catch (e) {
      return null;
    }
  }

  function encode(session) {
    var bytes = new TextEncoder().encode(JSON.stringify(session));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromHash(hash) {
    var text = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
    var values = [];
    text.split('&').forEach(function (part) {
      var at = part.indexOf('=');
      if (at !== -1 && part.slice(0, at) === 'session') values.push(part.slice(at + 1));
    });
    if (!values.length) return NONE;
    if (values.length > 1 || values[0].length > MAX_LINK) return DAMAGED;
    var json = decode(values[0]);
    return json === null ? DAMAGED : fromText(json);
  }

  // The save servers answer 404 {"error":"no session"} when there is no session file, and 404 with another reason
  // when there is one they would not use (invalid, too large, not a plain file): that one is damaged. Any other
  // status (wrong or used token, refused request) says nothing about the session: unreachable.
  function fromServer(status, body) {
    if (status !== 200 && status !== 404) return UNREACHABLE;
    if (typeof body !== 'string' || body.length > MAX_REPLY) return DAMAGED;
    var reply;
    try {
      reply = JSON.parse(body);
    } catch (e) {
      return DAMAGED;
    }
    if (status === 404) return reply && reply.error === 'no session' ? NONE : DAMAGED;
    if (
      !reply ||
      typeof reply !== 'object' ||
      Array.isArray(reply) ||
      !Object.prototype.hasOwnProperty.call(reply, 'session')
    ) {
      return DAMAGED;
    }
    return fromText(JSON.stringify(reply.session));
  }

  /* ---------- in the page ---------- */

  function boot(root, H) {
    var loc = root.location;
    var result = fromHash(loc.hash);
    var noteEl = null;
    var waiting = false; // the server is being asked: the notice waits for its answer (said once, not twice)

    function token() {
      if (loc.protocol !== 'http:' || loc.hostname !== '127.0.0.1') return null;
      var parts = loc.hash.replace(/^#/, '').split('&');
      for (var i = 0; i < parts.length; i++) {
        var m = /^token=([A-Za-z0-9_-]{20,256})$/.exec(parts[i]);
        if (m) return m[1];
      }
      return null;
    }

    function use(r) {
      result = r;
      if (r.status === 'ok') H.session = r.session;
      show();
    }

    var t = H.i18n.t;
    // Every key written out, so the dictionaries' check sees each one in use.
    var NOTE = { ok: { key: 'session.loaded' }, none: { key: 'session.none' }, damaged: { key: 'session.damaged' } };

    function show() {
      if (!noteEl || waiting) return;
      noteEl.textContent = t(NOTE[result.status].key);
      noteEl.setAttribute('data-tone', result.status === 'damaged' ? 'warn' : 'info');
      noteEl.setAttribute('data-session', result.status);
      noteEl.hidden = false;
    }

    var tk = token();
    var linkRefused = false;
    H.sessionData.linkRefused = function () {
      return linkRefused;
    };
    var ask = !!tk && typeof root.fetch === 'function';
    // Without a server the link is read at once, so the galleries start with it; with one, its answer decides.
    if (result.status === 'ok' && !ask) H.session = result.session;

    if (ask) {
      waiting = true;
      root
        .fetch('/api/session', { headers: { 'X-Hawiya-Token': tk }, cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) {
          // 401: this page's token is not the server's: a tab left from an earlier run on the fixed port (CHG-1).
          // export.js then never sends a save from it.
          if (res.status === 401) linkRefused = true;
          return res.text().then(function (body) {
            return fromServer(res.status, body);
          });
        })
        .then(
          function (r) {
            return r;
          },
          function () {
            return UNREACHABLE; // the server could not be reached
          }
        )
        .then(function (r) {
          // The server's session wins, and a session file it refuses is reported (damaged). When it has none or
          // gives no answer, what the link said stands.
          if (r.status === 'none' || r.status === 'unreachable') r = result;
          waiting = false;
          var before = H.session;
          use(r);
          // Galleries redraw only when the suggestions really change (a half-typed color is not wiped for nothing).
          if (H.session !== before) root.document.dispatchEvent(new root.CustomEvent('hawiya:session'));
        });
    }

    function init() {
      noteEl = root.document.getElementById('session-note');
      show();
      root.document.addEventListener('hawiya:lang', show);
    }
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { fromHash: fromHash, fromServer: fromServer, encode: encode, boot: boot };
});
