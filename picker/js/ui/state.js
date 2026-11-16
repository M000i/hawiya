/*
 * The identity being edited (task 2.5, R-031). Browser: window.Hawiya.state.
 * Load i18n, the core modules (… validate.js, resolve.js), picker/data/*.js and storage.js first.
 *
 *   state.choices()        a copy of the current choices (the input of resolve.resolve)
 *   state.identity()       the identity built from them (always passes the identity checker)
 *   state.change(fn [, how])  fn(copyOfChoices) edits the copy; it is applied only if the library can build it.
 *                          Returns true when applied. Every applied change is saved as the draft and fires
 *                          'hawiya:state'. A guard (rules-ui.js, the blocking rules) may refuse it first.
 *   state.chosen()         the elements the user chose (task 2.18), in element order: every element NOT in the
 *                          identity's autoFilled list. The list lives in the identity itself, so it is kept in the
 *                          draft, in saved identities and in the export (spec section 8: what the user did not
 *                          decide is marked as filled automatically). The page starts with every element in it.
 *                          A change takes the elements it edits out of the list; how = 'all' (a ready identity:
 *                          every element chosen), 'auto' («fill the rest», guided mode: it sets the list itself) or
 *                          a list of elements picked on purpose (a gallery card, even the one already in place).
 *   state.forget()         every element back in the list (the guided mode starts over); returns change()'s result
 *
 * On load the draft is restored when it can be read and rebuilt; otherwise the page starts from the first ready
 * identity (and the unreadable draft is kept aside, never deleted). The panel «my saved identities» saves the
 * current identity under a name, lists saved ones, and opens them. If the browser refuses storage, a notice says
 * so and everything else (choosing, previewing, exporting) keeps working.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;
  var STARTER = 'calm-corporate';

  var current = null; // { choices, identity }
  var ready = false;
  var openedId = null; // saved entry the user opened (Save updates it)
  var openedAt = null; // when that entry was last changed, as this page knows it (task 3.0b)
  var els = {};
  var store = null;
  var noteParts = null; // [key, params] of the last panel message, redrawn on a language switch

  function copy(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function build(choices) {
    return H.resolve.resolve(choices, H.library.view());
  }

  function starterChoices() {
    var ready = null;
    (H.data.identities || []).forEach(function (i) {
      if (i.id === STARTER) ready = i;
    });
    if (!ready) ready = H.data.identities[0];
    var selections = {};
    H.resolve.ELEMENTS.forEach(function (e) {
      selections[e] = { template: ready.templates[e] };
    });
    // The user has decided nothing yet: every element is the starting point's, filled automatically.
    return { name: ready.name.ar, selections: selections, autoFilled: H.resolve.ELEMENTS.slice() };
  }

  /* Opened from the save server (http://127.0.0.1:<port>/#token=…&project=<id>, task 3.0a): the project id, so the
     draft is kept per project while the saved identities are one list (task 3.0b, CHG-1 / R-101). As a file: null. */
  var FIXED_PORT = '47821';
  function fragment(name) {
    var parts = location.hash.replace(/^#/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(name + '=') === 0) return parts[i].slice(name.length + 1);
    }
    return null;
  }
  // Same rule as export.js and session.js: a token of 20 to 256 URL-safe characters, wherever it sits in the link.
  function fromSaveServer() {
    if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return false;
    return location.hash
      .replace(/^#/, '')
      .split('&')
      .some(function (p) {
        return /^token=[A-Za-z0-9_-]{20,256}$/.test(p);
      });
  }
  // From the save server, a link without a valid project id gets a draft of its own ("unknown"): never the general
  // draft of the page opened as a file.
  function projectId() {
    if (!fromSaveServer()) return null;
    var id = fragment('project');
    return id && /^[0-9a-f]{16}$/.test(id) ? id : 'unknown';
  }

  function browserStore() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null; // file:// in some browsers, or storage blocked
    }
  }

  /* ---------- messages ---------- */

  function showWarning(on) {
    els.warning.hidden = !on;
  }

  function note(key, params) {
    noteParts = key ? [key, params] : null;
    els.note.textContent = key ? t(key, params) : '';
  }

  function failed(reason) {
    if (reason === 'full') note('saved.full');
    else showWarning(true);
  }

  /* ---------- state ---------- */

  /* Returns false when the change could not be saved as the draft (the page says so). */
  function apply(choices, identity, persist) {
    current = { choices: choices, identity: identity };
    var kept = true;
    if (persist) {
      var r = store.writeDraft(identity, openedId, openedAt);
      if (!r.ok) {
        failed(r.reason);
        kept = false;
      }
    }
    if (els.name.value !== choices.name) els.name.value = choices.name; // keep the caret while typing
    els.nameError.hidden = true;
    document.dispatchEvent(new CustomEvent('hawiya:state', { detail: { choices: copy(choices) } }));
    return kept;
  }

  var guard = null; // set by rules-ui.js: refuses a change that breaks a blocking rule

  // An element's choice as text, the same whatever the key order of its adjustments.
  function selectionKey(s) {
    if (!s) return '';
    var ov = s.overrides || {};
    return JSON.stringify([
      s.template,
      Object.keys(ov)
        .sort()
        .map(function (k) {
          return [k, ov[k]];
        })
    ]);
  }

  function edited(before, after) {
    return H.resolve.ELEMENTS.filter(function (e) {
      return selectionKey(before.selections[e]) !== selectionKey(after.selections[e]);
    });
  }

  function change(fn, how) {
    var next = copy(current.choices);
    fn(next);
    var touched = how === 'all' ? H.resolve.ELEMENTS.slice() : how === 'auto' ? [] : edited(current.choices, next);
    // A gallery card picked on purpose is chosen even when it is the template already there.
    if (Array.isArray(how)) {
      how.forEach(function (e) {
        if (H.resolve.ELEMENTS.indexOf(e) !== -1 && touched.indexOf(e) === -1) touched.push(e);
      });
    }
    // An element the user edits is theirs now, no longer «filled automatically».
    if (how === 'all') next.autoFilled = [];
    else if (touched.length && Array.isArray(next.autoFilled)) {
      next.autoFilled = next.autoFilled.filter(function (e) {
        return touched.indexOf(e) === -1;
      });
    }
    var identity;
    try {
      identity = build(next);
    } catch (e) {
      return false;
    }
    if (guard && !guard(copy(next), copy(identity), how)) return false;
    apply(next, identity, true);
    return true;
  }

  H.state = {
    choices: function () {
      return copy(current.choices);
    },
    identity: function () {
      return copy(current.identity);
    },
    change: change,
    forget: function () {
      return change(function (c) {
        c.autoFilled = H.resolve.ELEMENTS.slice();
      }, 'auto');
    },
    chosen: function () {
      var auto = current.choices.autoFilled || [];
      return H.resolve.ELEMENTS.filter(function (e) {
        return auto.indexOf(e) === -1;
      });
    },
    /* setGuard(fn): fn(choices, identity, how) is asked before every change is applied; false refuses it. */
    setGuard: function (fn) {
      guard = typeof fn === 'function' ? fn : null;
    },
    /* Other modules start with H.state.whenReady(init): at once if the identity is ready, else on 'hawiya:ready'. */
    whenReady: function (fn) {
      if (ready) fn();
      else document.addEventListener('hawiya:ready', fn, { once: true });
    }
  };

  /* ---------- saved identities panel ---------- */

  function formatTime(ms) {
    if (typeof ms !== 'number') return '';
    try {
      return new Intl.DateTimeFormat(H.i18n.lang() === 'ar' ? 'ar-u-nu-latn' : 'en', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(ms));
    } catch (e) {
      return '';
    }
  }

  function statusText(status) {
    if (status === 'older') return t('saved.older');
    if (status === 'newer') return t('saved.newer');
    if (status === 'damaged') return t('saved.damaged');
    return '';
  }

  function renderList() {
    var items = store.list();
    els.list.textContent = '';
    els.empty.hidden = items.length > 0;
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'saved-item';
      var name = document.createElement('span');
      name.className = 'saved-name';
      name.setAttribute('dir', 'auto');
      name.textContent = item.name || t('saved.unnamed'); // text only, never HTML
      li.appendChild(name);
      var meta = document.createElement('span');
      meta.className = 'saved-meta';
      meta.textContent = item.status === 'ok' ? formatTime(item.updatedAt) : statusText(item.status);
      li.appendChild(meta);
      if (item.status === 'ok') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary-btn';
        btn.setAttribute('data-open', item.id);
        btn.textContent = t('saved.open');
        btn.setAttribute('aria-label', t('saved.openNamed', { name: item.name }));
        li.appendChild(btn);
      } else {
        li.setAttribute('data-status', item.status);
      }
      if (item.id && item.id === openedId) li.setAttribute('aria-current', 'true');
      els.list.appendChild(li);
    });
  }

  function onSave(asNew) {
    var r = store.save(current.identity, asNew ? null : openedId, openedAt);
    if (!r.ok) {
      failed(r.reason);
      if (r.reason !== 'full') note('saved.failed');
      return;
    }
    openedId = r.id;
    openedAt = r.updatedAt;
    store.writeDraft(current.identity, openedId, openedAt); // so Save keeps updating this entry after a reload
    // The entry changed elsewhere since it was opened here (another project or tab): kept, and this is a copy.
    if (r.conflict) note('saved.conflictCopy', { name: current.choices.name });
    else if (r.created) note('saved.created', { name: current.choices.name });
    else note('saved.updated', { name: current.choices.name });
    renderList();
  }

  // Load the elements a saved entry needs first (task 2.9), then open it.
  function onOpen(id) {
    var sel = store.entrySelections(id);
    if (H.library.missing(sel).length === 0) return openNow(id);
    H.library.ensure(sel).then(
      function () {
        openNow(id);
      },
      function () {
        note('saved.missing');
      }
    );
  }

  function openNow(id) {
    var r = store.open(id);
    if (!r.ok) {
      if (r.reason === 'missing') note('saved.missing');
      else note('saved.cannotOpen');
      return;
    }
    var identity;
    try {
      identity = build(r.choices);
    } catch (e) {
      note('saved.missing');
      return;
    }
    openedId = id;
    openedAt = r.updatedAt;
    // If the draft could not be written, the failure notice stays: never claim it is saved.
    if (apply(r.choices, identity, true)) note('saved.opened', { name: r.choices.name });
    renderList();
  }

  function onName() {
    var name = els.name.value;
    var ok = change(function (c) {
      c.name = name;
    });
    // An invalid name (empty, or with characters the identity forbids) is not applied; the field keeps
    // what was typed so it can be corrected.
    els.nameError.hidden = ok;
    if (!ok) els.name.value = name;
  }

  function init() {
    els.warning = document.getElementById('storage-warning');
    els.note = document.getElementById('saved-note');
    els.name = document.getElementById('identity-name');
    els.nameError = document.getElementById('identity-name-error');
    els.list = document.getElementById('saved-list');
    els.empty = document.getElementById('saved-empty');

    var raw = browserStore();
    store = H.storage.create(raw, {
      check: function (x) {
        return H.validate.check('identity', x).valid;
      },
      resolve: build,
      now: function () {
        return Date.now();
      },
      project: projectId()
    });
    showWarning(!store.available());
    // On the fallback port the address differs from every earlier run: the identities saved then are not here.
    document.getElementById('port-fallback').hidden = !(fromSaveServer() && location.port !== FIXED_PORT);

    // The draft may use templates outside the starter set: load their elements first (task 2.9). When nothing is
    // missing this runs at once, so the page is ready as soon as the scripts have run.
    var sel = store.draftSelections();
    if (H.library.missing(sel).length === 0) start();
    else H.library.ensure(sel).then(start, start); // a file that cannot load: the draft reads as unreadable, kept

    document.getElementById('save-btn').addEventListener('click', function () {
      onSave(false);
    });
    document.getElementById('save-new-btn').addEventListener('click', function () {
      onSave(true);
    });
    els.list.addEventListener('click', function (e) {
      var id = e.target && e.target.getAttribute && e.target.getAttribute('data-open');
      if (id) onOpen(id);
    });
    els.name.addEventListener('input', onName);
    // Another tab saved or changed something: show the current list.
    window.addEventListener('storage', function (e) {
      if (e.key === null || e.key === H.storage.KEYS.saved) renderList();
    });
    document.addEventListener('hawiya:lang', function () {
      if (noteParts) els.note.textContent = t(noteParts[0], noteParts[1]);
      renderList();
    });
  }

  function start() {
    var draft = store.readDraft();
    var choices = draft.status === 'ok' ? draft.choices : starterChoices();
    if (draft.status === 'ok' && draft.openedId) {
      openedId = draft.openedId;
      openedAt = typeof draft.openedAt === 'number' ? draft.openedAt : null;
    }
    apply(choices, build(choices), false);
    if (draft.status === 'unreadable') note('saved.draftUnreadable');
    if (store.listUnreadable()) note('saved.listUnreadable');
    renderList();
    ready = true;
    document.dispatchEvent(new CustomEvent('hawiya:ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
