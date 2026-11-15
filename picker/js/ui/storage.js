/*
 * Browser storage of the user's work (task 2.5, R-031). Browser: window.Hawiya.storage. Node: require (tests).
 *
 *   var s = storage.create(store, { check, resolve, now })
 *     store    localStorage-like object (getItem/setItem/removeItem/key/length), or null when the browser
 *              refuses storage; every call is guarded, a throwing store never breaks the page
 *     check    identity => boolean        (validate.check('identity', x).valid)
 *     resolve  choices => identity        (resolve.resolve; throws when the library cannot build them)
 *     now      () => milliseconds         (Date.now)
 *
 *   s.available()            can we write right now?
 *   s.readDraft()            { status: 'none' | 'ok' | 'unreadable', choices? }
 *   s.writeDraft(identity)   { ok, reason? }      reason: 'unavailable' | 'full'
 *   s.list()                 [{ id, name, updatedAt, schemaVersion, status: 'ok' | 'older' | 'newer' | 'damaged' }]
 *   s.save(identity, id?)    { ok, id, created, reason? }   updates entry `id` when it is a current, readable one
 *   s.open(id)               { ok, choices } or { ok: false, reason: 'gone' | 'older' | 'newer' | 'damaged' | 'missing' }
 *
 * Nothing the user saved is ever deleted or overwritten by accident:
 * - Anything read back is checked (identity checker, then rebuilt from its choices with the current library)
 *   before it is used; the stored values themselves are never used directly.
 * - Entries in another format version, or damaged, stay in the list exactly as they were and cannot be opened.
 * - A list or draft that cannot be read at all is copied to a backup key before anything new is written there.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.storage = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1; // identity schemaVersion this page reads and writes
  var DRAFT = 'hawiya.draft';
  var SAVED = 'hawiya.saved';
  var BACKUP = '.unreadable-';
  var ID = /^[a-z0-9]{1,40}$/;

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function isObj(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  /* The choices an identity was built from (what the page edits); never its computed values. */
  function choicesOf(identity) {
    var c = {
      name: identity.name,
      selections: {},
      project: { type: identity.project.type, contrast: identity.project.contrast }
    };
    Object.keys(identity.selections).forEach(function (e) {
      var s = identity.selections[e];
      c.selections[e] = { template: s.template };
      if (s.overrides) {
        c.selections[e].overrides = {};
        Object.keys(s.overrides).forEach(function (k) {
          c.selections[e].overrides[k] = s.overrides[k];
        });
      }
    });
    c.motion = identity.extensions.motion;
    c.autoFilled = identity.autoFilled.slice();
    c.leaveToAI = identity.leaveToAI.slice();
    return c;
  }

  // Label of an entry that cannot be opened: no control or direction characters, at most 80 characters.
  function cleanLabel(name) {
    if (typeof name !== 'string') return '';
    var s = name.replace(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g,
      ''
    );
    return Array.from(s)
      .filter(function (ch) {
        return !/^[\ud800-\udfff]$/.test(ch);
      })
      .slice(0, 80)
      .join('');
  }

  function create(store, deps) {
    var check = deps.check;
    var resolve = deps.resolve;
    var now = deps.now;

    function get(key) {
      try {
        return store ? store.getItem(key) : null;
      } catch (e) {
        return null;
      }
    }
    // A read that fails is not "nothing stored": writes that would replace what is there are refused.
    function read(key) {
      if (!store) return { ok: false };
      try {
        return { ok: true, value: store.getItem(key) };
      } catch (e) {
        return { ok: false };
      }
    }
    function set(key, value) {
      if (!store) return 'unavailable';
      try {
        store.setItem(key, value);
        return null;
      } catch (e) {
        return e && (e.name === 'QuotaExceededError' || e.code === 22) ? 'full' : 'unavailable';
      }
    }
    function parse(text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return undefined;
      }
    }

    /* Keep an unreadable value before replacing it. Fails closed: no backup, no replacement. */
    function keepUnreadable(key, raw) {
      if (raw === null) return null;
      var name = key + BACKUP + now();
      for (var i = 0; get(name) !== null; i++) name = key + BACKUP + now() + '-' + i;
      return set(name, raw);
    }

    /* identity (as stored) → choices rebuilt with the current library, or the reason it cannot be used. */
    function usable(identity) {
      if (!isObj(identity) || !hasOwn(identity, 'schemaVersion')) return { reason: 'damaged' };
      if (identity.schemaVersion !== VERSION) {
        if (typeof identity.schemaVersion !== 'number') return { reason: 'damaged' };
        return { reason: identity.schemaVersion < VERSION ? 'older' : 'newer' };
      }
      if (!check(identity)) return { reason: 'damaged' };
      var choices = choicesOf(identity);
      try {
        resolve(choices);
      } catch (e) {
        return { reason: 'missing' };
      }
      return { choices: choices };
    }

    /* ---------- draft ---------- */

    function readDraft() {
      var raw = get(DRAFT);
      if (raw === null) return { status: 'none' };
      var d = parse(raw);
      var u = isObj(d) && d.format === 1 ? usable(d.identity) : { reason: 'damaged' };
      if (!u.choices) return { status: 'unreadable', reason: u.reason };
      var out = { status: 'ok', choices: u.choices };
      // The saved entry the draft was opened from, so Save keeps updating it after a reload.
      if (typeof d.openedId === 'string' && ID.test(d.openedId)) out.openedId = d.openedId;
      return out;
    }

    function writeDraft(identity, openedId) {
      var r = read(DRAFT);
      if (!r.ok) return { ok: false, reason: 'unavailable' };
      if (r.value !== null && readDraft().status !== 'ok') {
        var kept = keepUnreadable(DRAFT, r.value);
        if (kept) return { ok: false, reason: kept };
      }
      var d = { format: 1, savedAt: now(), identity: identity };
      if (typeof openedId === 'string' && ID.test(openedId)) d.openedId = openedId;
      var err = set(DRAFT, JSON.stringify(d));
      return err ? { ok: false, reason: err } : { ok: true };
    }

    /* ---------- saved identities ---------- */

    // The container as stored: { format: 1, items: [...] }. Items are kept as raw objects so that an entry
    // this page cannot read is written back unchanged.
    function readList() {
      var r = read(SAVED);
      if (!r.ok) return { items: [], raw: null, readable: false, failed: true };
      var raw = r.value;
      if (raw === null) return { items: [], raw: null, readable: true };
      var d = parse(raw);
      if (isObj(d) && d.format === 1 && Array.isArray(d.items)) return { items: d.items, raw: raw, readable: true };
      return { items: [], raw: raw, readable: false };
    }

    function describe(item) {
      var ok = isObj(item) && typeof item.id === 'string' && ID.test(item.id);
      var u = ok ? usable(item.identity) : { reason: 'damaged' };
      return {
        id: ok ? item.id : null,
        // A readable entry shows its checked identity's name; any other shows a cleaned copy of its label.
        name: u.choices || u.reason === 'missing' ? item.identity.name : ok ? cleanLabel(item.name) : '',
        updatedAt: ok && typeof item.updatedAt === 'number' && isFinite(item.updatedAt) ? item.updatedAt : null,
        schemaVersion:
          ok && isObj(item.identity) && typeof item.identity.schemaVersion === 'number'
            ? item.identity.schemaVersion
            : null,
        status: u.choices ? 'ok' : u.reason === 'missing' ? 'ok-missing' : u.reason
      };
    }

    function list() {
      return readList()
        .items.map(describe)
        .map(function (d) {
          // A current entry whose templates left the library is still a current entry; open() explains.
          if (d.status === 'ok-missing') d.status = 'ok';
          return d;
        });
    }

    function newId(items) {
      var base = now().toString(36);
      var id = base;
      for (var i = 1; items.some(isId(id)); i++) id = base + i.toString(36);
      return id;
    }
    function isId(id) {
      return function (item) {
        return isObj(item) && item.id === id;
      };
    }

    /* Is there a saved list this page cannot read (kept aside, never deleted, on the next save)? */
    function listUnreadable() {
      var L = readList();
      return !L.readable && !L.failed;
    }

    function save(identity, id) {
      var L = readList();
      if (L.failed) return { ok: false, reason: 'unavailable' };
      if (!L.readable) {
        var kept = keepUnreadable(SAVED, L.raw);
        if (kept) return { ok: false, reason: kept };
      }
      var items = L.items.slice();
      var at = typeof id === 'string' ? items.findIndex(isId(id)) : -1;
      // Only a current, readable entry is ever replaced; anything else gets a new entry beside it.
      if (at !== -1 && describe(items[at]).status !== 'ok' && describe(items[at]).status !== 'ok-missing') at = -1;
      var entry = {
        id: at === -1 ? newId(items) : items[at].id,
        name: identity.name,
        updatedAt: now(),
        identity: identity
      };
      if (at === -1) items.push(entry);
      else items[at] = entry;
      var err = set(SAVED, JSON.stringify({ format: 1, items: items }));
      return err ? { ok: false, reason: err } : { ok: true, id: entry.id, created: at === -1 };
    }

    function open(id) {
      var item = readList().items.find(isId(id));
      if (!item) return { ok: false, reason: 'gone' };
      var u = usable(item.identity);
      return u.choices ? { ok: true, choices: u.choices } : { ok: false, reason: u.reason };
    }

    function available() {
      if (!store) return false;
      var probe = 'hawiya.probe';
      try {
        store.setItem(probe, '1');
        store.removeItem(probe);
        return true;
      } catch (e) {
        return false;
      }
    }

    return {
      available: available,
      readDraft: readDraft,
      writeDraft: writeDraft,
      list: list,
      listUnreadable: listUnreadable,
      save: save,
      open: open
    };
  }

  return { create: create, choicesOf: choicesOf, VERSION: VERSION, KEYS: { draft: DRAFT, saved: SAVED } };
});
