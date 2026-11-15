/*
 * First screen: the ready identities (task 2.8, R-020). Browser: window.Hawiya.identities.
 * Load i18n, the library data, resolve.js and state.js first.
 *
 * One card per published ready identity (picker/data/identities.js), each showing its Arabic AND English name
 * whatever the interface language, plus its description in the interface language, its two colors and its font.
 * One click puts all of its templates in the choices (every element, adjustments cleared), so the identity is
 * complete and the preview and the draft follow at once. The card whose templates are exactly the current
 * choices is marked as pressed.
 * Card content comes from the library and is written as text only.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var els = {};

  function ready() {
    return (H.data && H.data.identities) || [];
  }

  function template(element, id) {
    return H.library.find(element, id);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Do the current choices equal this ready identity exactly (every template, no adjustment)? */
  function matches(identity, choices) {
    return H.resolve.ELEMENTS.every(function (e) {
      var s = choices.selections[e];
      return s && s.template === identity.templates[e] && !s.overrides;
    });
  }

  function isReadyName(name) {
    return ready().some(function (i) {
      return i.name.ar === name || i.name.en === name;
    });
  }

  function use(id) {
    var identity = null;
    ready().forEach(function (i) {
      if (i.id === id) identity = i;
    });
    if (!identity) return false;
    return H.state.change(function (c) {
      H.resolve.ELEMENTS.forEach(function (e) {
        c.selections[e] = { template: identity.templates[e] };
      });
      // A name the user typed is theirs; a ready identity's name follows the identity picked.
      if (isReadyName(c.name)) c.name = identity.name.ar;
    });
  }

  function card(identity) {
    var b = el('button', 'identity-card');
    b.type = 'button';
    b.setAttribute('data-identity', identity.id);
    b.setAttribute('aria-pressed', 'false');

    var swatches = el('span', 'identity-swatches');
    swatches.setAttribute('aria-hidden', 'true');
    var colors = template('colors', identity.templates.colors);
    ['primary', 'secondary'].forEach(function (role) {
      var tok = colors && colors.tokens.color[role];
      var hex = tok && tok.$value && tok.$value.hex;
      if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
        var dot = el('span', 'identity-dot');
        dot.style.backgroundColor = hex;
        swatches.appendChild(dot);
      }
    });
    b.appendChild(swatches);

    var names = el('span', 'identity-names');
    var ar = el('span', 'identity-name', identity.name.ar);
    ar.setAttribute('lang', 'ar');
    ar.setAttribute('dir', 'rtl');
    var en = el('span', 'identity-name-en', identity.name.en);
    en.setAttribute('lang', 'en');
    en.setAttribute('dir', 'ltr');
    names.appendChild(ar);
    names.appendChild(en);
    b.appendChild(names);

    var lang = H.i18n.lang();
    if (identity.description && identity.description[lang]) {
      b.appendChild(el('span', 'identity-desc', identity.description[lang]));
    }
    var font = template('fonts', identity.templates.fonts);
    if (font && font.extras) {
      var fams = [font.extras.arabic, font.extras.latin].filter(function (n, i, all) {
        return typeof n === 'string' && all.indexOf(n) === i;
      });
      var f = el('span', 'identity-font', fams.join(' + ')); // font family names are the same in both languages
      f.setAttribute('dir', 'ltr');
      b.appendChild(f);
    }
    b.addEventListener('click', function () {
      use(identity.id);
    });
    return b;
  }

  // The cards can be shown in more than one place: the first screen, and the advanced mode's entry (task 2.9).
  var lists = [];

  function fill(list) {
    list.textContent = '';
    ready().forEach(function (identity) {
      list.appendChild(card(identity));
    });
  }

  function render() {
    lists.forEach(fill);
    els.empty.hidden = ready().length > 0;
    mark();
  }

  function renderInto(container) {
    var list = document.createElement('div');
    list.className = 'identity-list';
    container.textContent = '';
    container.appendChild(list);
    lists.push(list);
    fill(list);
    mark();
  }

  function mark() {
    var c = H.state.choices();
    var cards = [];
    lists.forEach(function (list) {
      cards = cards.concat(Array.prototype.slice.call(list.querySelectorAll('[data-identity]')));
    });
    cards.forEach(function (b) {
      var id = b.getAttribute('data-identity');
      var identity = null;
      ready().forEach(function (i) {
        if (i.id === id) identity = i;
      });
      b.setAttribute('aria-pressed', String(!!identity && matches(identity, c)));
    });
  }

  H.identities = { use: use, renderInto: renderInto };

  function init() {
    els.empty = document.getElementById('identity-empty');
    lists.push(document.getElementById('identity-list'));
    render();
    document.addEventListener('hawiya:state', mark);
    document.addEventListener('hawiya:lang', render);
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
