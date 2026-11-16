/*
 * The identity being edited (task 2.5, R-031). Browser: window.Hawiya.state.
 * Load i18n, the core modules (… validate.js, resolve.js), picker/data/*.js and storage.js first.
 *
 *   state.choices()        a copy of the current choices (the input of resolve.resolve)
 *   state.identity()       the identity built from them (always passes the identity checker)
 *   state.change(fn)       fn(copyOfChoices) edits the copy; it is applied only if the library can build it.
 *                          Returns true when applied. Every applied change is saved as the draft and fires
 *                          'hawiya:state'. A guard (rules-ui.js, the blocking rules) may refuse it first.
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
    return { name: ready.name.ar, selections: selections };
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
      var r = store.writeDraft(identity, openedId);
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

  function change(fn) {
    var next = copy(current.choices);
    fn(next);
    var identity;
    try {
      identity = build(next);
    } catch (e) {
      return false;
    }
    if (guard && !guard(copy(next), copy(identity))) return false;
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
    /* setGuard(fn): fn(choices, identity) is asked before every change is applied; false refuses it. */
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
    var r = store.save(current.identity, asNew ? null : openedId);
    if (!r.ok) {
      failed(r.reason);
      if (r.reason !== 'full') note('saved.failed');
      return;
    }
    openedId = r.id;
    store.writeDraft(current.identity, openedId); // so Save keeps updating this entry after a reload
    if (r.created) note('saved.created', { name: current.choices.name });
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
      }
    });
    showWarning(!store.available());

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
    if (draft.status === 'ok' && draft.openedId) openedId = draft.openedId;
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
