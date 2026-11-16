/*
 * Advanced mode: the list of the 12 elements and their galleries (task 2.9, R-023). Browser: window.Hawiya.gallery.
 * Load i18n, library.js, state.js, identities.js and the element parts (elements/*.js) first.
 *
 * Each element opens a panel. Its data file is loaded the first time the panel opens (library.load), never before.
 * The panel shows one card per published template (its name in the interface language, and a picture when the
 * element has a part in H.galleryParts); a click chooses it (adjustments cleared). Under the cards, the element's
 * sliders adjust the chosen template through the identity's allowed adjustments; a value equal to the
 * template's own is dropped. The "ready identity" entry shows the ready identity cards.
 * Specific galleries (colors, fonts, icons, buttons, cards, modes, direction) are filled in tasks 2.10 to 2.13.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;

  var ENTRIES = [
    { id: 'identities', key: 'element.identities' },
    { id: 'colors', key: 'element.colors' },
    { id: 'modes', key: 'element.modes' },
    { id: 'fonts', key: 'element.fonts' },
    { id: 'type-scale', key: 'element.typeScale' },
    { id: 'radius', key: 'element.radius' },
    { id: 'shadows', key: 'element.shadows' },
    { id: 'icons', key: 'element.icons' },
    { id: 'buttons', key: 'element.buttons' },
    { id: 'cards', key: 'element.cards' },
    { id: 'spacing', key: 'element.spacing' },
    { id: 'direction', key: 'element.direction' }
  ];

  var els = {};
  var opened = {}; // element -> panel element, once its data is in

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function nameOf(template) {
    var lang = H.i18n.lang();
    return (template.name && (template.name[lang] || template.name.ar)) || template.id;
  }

  function chosen(element) {
    var s = H.state.choices().selections[element];
    return s ? s.template : null;
  }

  /* Set an adjustment, or drop it when it equals the template's own value. */
  function setOverride(c, element, name, value, own) {
    var s = c.selections[element];
    var ov = s.overrides || {};
    if (Math.abs(value - own) < 1e-9) delete ov[name];
    else ov[name] = value;
    if (Object.keys(ov).length) s.overrides = ov;
    else delete s.overrides;
  }

  /* ---------- panel ---------- */

  function sliderRow(element, def) {
    var row = el('label', 'g-slider');
    var id = 'g-' + element + '-' + def.name;
    var label = el('span', 'g-slider-label');
    label.setAttribute('data-i18n', def.key);
    label.textContent = t(def.key);
    var input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.setAttribute('data-adjust', def.name);
    input.setAttribute('data-i18n-attr', 'aria-label:' + def.key);
    input.setAttribute('aria-label', t(def.key));
    var out = el('output', 'g-slider-value');
    out.setAttribute('for', id);
    out.setAttribute('dir', 'ltr'); // "16 px" stays in that order in Arabic too
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(out);
    input.addEventListener('input', function () {
      var v = Number(input.value);
      var ok = H.state.change(function (c) {
        var tpl = H.library.find(element, c.selections[element].template);
        setOverride(c, element, def.name, v, def.base(tpl));
      });
      // A value the identity cannot take (e.g. type sizes beyond 200 px) is refused: say so, show the real value.
      var panel = opened[element];
      if (panel) panel.querySelector('.g-refused').hidden = ok;
      if (!ok) syncSliders(element);
    });
    return row;
  }

  function syncSliders(element) {
    var panel = opened[element];
    var part = H.galleryParts && H.galleryParts[element];
    if (!panel || !part || !part.sliders) return;
    var identity = H.state.identity();
    var choices = H.state.choices();
    part.sliders.forEach(function (def) {
      var v = def.current(identity, choices);
      var input = panel.querySelector('input[data-adjust="' + def.name + '"]');
      var out = input && input.nextSibling;
      if (!input) return;
      input.value = String(v);
      out.textContent = def.unit === 'px' ? t('gallery.px', { value: v }) : t('gallery.number', { value: v });
    });
  }

  // The template that best suits the other choices (and the session), among those the rules allow (R-025).
  function fitting(element) {
    if (!H.match) return null;
    var identity = H.state.identity();
    return H.match.best(
      element,
      H.library.view().templates[element],
      identity.selections,
      H.library.find,
      H.session || null,
      function (tpl) {
        return !H.rules || H.rules.allowed(tpl, identity.project);
      }
    );
  }

  function markCards(element) {
    var panel = opened[element];
    if (!panel) return;
    var current = chosen(element);
    var fit = fitting(element);
    Array.prototype.forEach.call(panel.querySelectorAll('[data-template]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-template') === current));
      var badge = b.querySelector('.g-fit');
      if (b.getAttribute('data-template') === fit) {
        if (!badge) {
          badge = el('span', 'g-fit', t('gallery.fit'));
          badge.setAttribute('data-fit', 'true');
          b.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // What an element part gets: helpers, the current identity and choices, and a way to change the choices.
  function partContext(element) {
    return {
      el: el,
      t: t,
      element: element,
      identity: H.state.identity(),
      choices: H.state.choices(),
      change: H.state.change,
      template: function (id) {
        return H.library.find(element, id);
      }
    };
  }

  function fillPanel(panel, element) {
    panel.textContent = '';
    var part = H.galleryParts && H.galleryParts[element];
    // A part may add its own controls before the cards (e.g. suggestions) and after them (e.g. inputs, results).
    if (part && part.before) panel.appendChild(part.before(partContext(element)));
    var cards = el('div', 'g-cards');
    H.library.view().templates[element].forEach(function (tpl) {
      var b = el('button', 'g-card');
      b.type = 'button';
      b.setAttribute('data-template', tpl.id);
      if (part && part.sample) b.appendChild(part.sample(tpl, { el: el, t: t }));
      b.appendChild(el('span', 'g-card-name', nameOf(tpl)));
      b.addEventListener('click', function () {
        // A part may keep some adjustments when its template changes (direction keeps numerals and calendar).
        H.state.change(function (c) {
          if (part && part.pick) part.pick(c, tpl);
          else c.selections[element] = { template: tpl.id };
        });
      });
      cards.appendChild(b);
    });
    panel.appendChild(cards);
    if (part && part.sliders) {
      var sliders = el('div', 'g-sliders');
      part.sliders.forEach(function (def) {
        sliders.appendChild(sliderRow(element, def));
      });
      panel.appendChild(sliders);
      var refused = el('p', 'note g-refused');
      refused.setAttribute('data-i18n', 'gallery.refused');
      refused.textContent = t('gallery.refused');
      refused.hidden = true;
      panel.appendChild(refused);
    }
    if (part && part.after) panel.appendChild(part.after(partContext(element)));
    opened[element] = panel;
    markCards(element);
    syncSliders(element);
    updatePart(element);
  }

  function updatePart(element) {
    var part = H.galleryParts && H.galleryParts[element];
    if (part && part.update && opened[element]) part.update(opened[element], partContext(element));
  }

  function open(entry, button, panel) {
    var expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
    if (expanded || opened[entry.id]) return Promise.resolve();
    if (entry.id === 'identities') {
      H.identities.renderInto(panel);
      opened.identities = panel;
      return Promise.resolve();
    }
    var note = el('p', 'note');
    note.setAttribute('data-i18n', 'gallery.loading');
    note.textContent = t('gallery.loading');
    panel.textContent = '';
    panel.appendChild(note);
    return H.library.load(entry.id).then(
      function () {
        fillPanel(panel, entry.id);
      },
      function () {
        note.setAttribute('data-i18n', 'gallery.loadFailed');
        note.textContent = t('gallery.loadFailed');
      }
    );
  }

  function summary(entry) {
    if (entry.id === 'identities') return '';
    var tpl = H.library.find(entry.id, chosen(entry.id));
    return tpl ? nameOf(tpl) : '';
  }

  function render() {
    els.list.textContent = '';
    ENTRIES.forEach(function (entry) {
      var li = el('li', 'g-entry');
      li.setAttribute('data-element', entry.id);
      var button = el('button', 'g-toggle');
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      var panelId = 'g-panel-' + entry.id;
      button.setAttribute('aria-controls', panelId);
      var label = el('span', 'g-toggle-label');
      label.setAttribute('data-i18n', entry.key);
      label.textContent = t(entry.key);
      button.appendChild(label);
      button.appendChild(el('span', 'g-toggle-current', summary(entry)));
      var panel = el('div', 'g-panel');
      panel.id = panelId;
      panel.hidden = true;
      button.addEventListener('click', function () {
        open(entry, button, panel);
      });
      li.appendChild(button);
      li.appendChild(panel);
      els.list.appendChild(li);
    });
  }

  function refresh() {
    ENTRIES.forEach(function (entry) {
      var li = els.list.querySelector('[data-element="' + entry.id + '"]');
      if (li) li.querySelector('.g-toggle-current').textContent = summary(entry);
      if (entry.id !== 'identities') {
        markCards(entry.id);
        syncSliders(entry.id);
        updatePart(entry.id);
      }
    });
  }

  function relabel() {
    // Names of templates follow the interface language; panels already loaded are redrawn.
    Object.keys(opened).forEach(function (element) {
      if (element !== 'identities') fillPanel(opened[element], element);
    });
    refresh();
  }

  /* A labelled row of choice buttons for a part's settings (fill, container, numerals, calendar, ...).
     def: { key, items: [{ id, key }], attr, pick(id) }; the part marks the pressed one in its update. */
  function segment(ctx, def) {
    var box = ctx.el('div', 'i-setting');
    var title = ctx.el('p', 'c-title');
    title.setAttribute('data-i18n', def.key);
    title.textContent = ctx.t(def.key);
    box.appendChild(title);
    var seg = ctx.el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('data-i18n-attr', 'aria-label:' + def.key);
    seg.setAttribute('aria-label', ctx.t(def.key));
    def.items.forEach(function (item) {
      var b = ctx.el('button');
      b.type = 'button';
      b.setAttribute(def.attr, item.id);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('data-i18n', item.key);
      b.textContent = ctx.t(item.key);
      b.addEventListener('click', function () {
        def.pick(item.id);
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    return box;
  }

  H.gallery = {
    segment: segment,
    open: function (element) {
      var li = els.list.querySelector('[data-element="' + element + '"]');
      if (!li) return Promise.reject(new Error('unknown element ' + element));
      var button = li.querySelector('.g-toggle');
      if (button.getAttribute('aria-expanded') === 'true') return Promise.resolve();
      return open(
        ENTRIES.filter(function (e) {
          return e.id === element;
        })[0],
        button,
        li.querySelector('.g-panel')
      );
    }
  };

  function init() {
    els.list = document.getElementById('element-list');
    render();
    document.addEventListener('hawiya:state', refresh);
    document.addEventListener('hawiya:refused', refresh); // a refused change was dismissed (rules-ui.js)
    document.addEventListener('hawiya:lang', relabel);
  }

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
