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
    var list = (H.data.templates && H.data.templates[element]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
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

  function render() {
    els.list.textContent = '';
    ready().forEach(function (identity) {
      els.list.appendChild(card(identity));
    });
    els.empty.hidden = ready().length > 0;
    mark();
  }

  function mark() {
    var c = H.state.choices();
    Array.prototype.forEach.call(els.list.querySelectorAll('[data-identity]'), function (b) {
      var id = b.getAttribute('data-identity');
      var identity = null;
      ready().forEach(function (i) {
        if (i.id === id) identity = i;
      });
      b.setAttribute('aria-pressed', String(!!identity && matches(identity, c)));
    });
  }

  H.identities = { use: use };

  function init() {
    els.list = document.getElementById('identity-list');
    els.empty = document.getElementById('identity-empty');
    render();
    document.addEventListener('hawiya:state', mark);
    document.addEventListener('hawiya:lang', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
