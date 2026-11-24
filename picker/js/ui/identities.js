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
 *
 * Order: with a session (what the agent read in the project), the cards go from the best fit down
 * (picker/js/core/fit.js), the first is marked as the best fit, and the first five that fit at all say why
 * (the two strongest of: sector, feel, brand color, project type). Without a session the library order
 * stays and nothing is added.
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

  // Every text key is written out here, so the i18n test sees it used.
  var WHY = {
    sector: { key: 'fit.why.sector' },
    tags: { key: 'fit.why.tags' },
    type: { key: 'fit.why.type' },
    brand: { key: 'fit.why.brand' }
  };
  var NAMES = {
    sector: {
      finance: { key: 'fit.sector.finance' },
      health: { key: 'fit.sector.health' },
      government: { key: 'fit.sector.government' },
      education: { key: 'fit.sector.education' },
      technology: { key: 'fit.sector.technology' },
      commerce: { key: 'fit.sector.commerce' },
      food: { key: 'fit.sector.food' },
      culture: { key: 'fit.sector.culture' },
      media: { key: 'fit.sector.media' },
      creative: { key: 'fit.sector.creative' },
      kids: { key: 'fit.sector.kids' },
      nature: { key: 'fit.sector.nature' },
      hospitality: { key: 'fit.sector.hospitality' },
      fashion: { key: 'fit.sector.fashion' },
      realestate: { key: 'fit.sector.realestate' },
      nonprofit: { key: 'fit.sector.nonprofit' },
      professional: { key: 'fit.sector.professional' }
    },
    tags: {
      minimal: { key: 'fit.tag.minimal' },
      corporate: { key: 'fit.tag.corporate' },
      editorial: { key: 'fit.tag.editorial' },
      playful: { key: 'fit.tag.playful' },
      luxury: { key: 'fit.tag.luxury' },
      glass: { key: 'fit.tag.glass' },
      brutalist: { key: 'fit.tag.brutalist' },
      neumorphic: { key: 'fit.tag.neumorphic' },
      retro: { key: 'fit.tag.retro' },
      material: { key: 'fit.tag.material' },
      cupertino: { key: 'fit.tag.cupertino' },
      fluent: { key: 'fit.tag.fluent' },
      technical: { key: 'fit.tag.technical' },
      'data-dense': { key: 'fit.tag.dataDense' },
      vivid: { key: 'fit.tag.vivid' },
      soft: { key: 'fit.tag.soft' }
    },
    type: {
      landing: { key: 'fit.type.landing' },
      website: { key: 'fit.type.website' },
      'web-app': { key: 'fit.type.webApp' },
      dashboard: { key: 'fit.type.dashboard' },
      'html-page': { key: 'fit.type.htmlPage' }
    }
  };
  var SHOW_WHY = 5; // cards that say why they fit
  var WHY_SHOWN = 2; // the strongest reasons only, so the card stays short

  function t(key, params) {
    return H.i18n.t(key, params);
  }

  function primaryOf(identity) {
    var colors = template('colors', identity.templates.colors);
    var tok = colors && colors.tokens.color.primary;
    var hex = tok && tok.$value && tok.$value.hex;
    return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null;
  }

  // The identities in the order to show, each with its score and reasons.
  function ranked() {
    var all = ready();
    var byId = {};
    all.forEach(function (i) {
      byId[i.id] = i;
    });
    var order = H.fit
      ? H.fit.rank(all, H.session || null, primaryOf)
      : all.map(function (i) {
          return { id: i.id, score: 0, reasons: [] };
        });
    return order.map(function (r) {
      return { identity: byId[r.id], score: r.score, reasons: r.reasons };
    });
  }

  function whyText(reasons) {
    return reasons
      .map(function (r) {
        var names = NAMES[r.kind] || {};
        var list = r.values
          .map(function (v) {
            return names[v] ? t(names[v].key) : v;
          })
          .join(t('fit.sep'));
        return t(WHY[r.kind].key, { list: list });
      })
      .join(' \u00b7 ');
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
    }, 'all'); // a ready identity is a choice for every element (nothing left to fill)
  }

  function card(identity, fit, best) {
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
    if (best) names.appendChild(el('span', 'identity-best', t('identity.best')));
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
    if (fit && fit.reasons.length) b.appendChild(el('span', 'identity-why', whyText(fit.reasons.slice(0, WHY_SHOWN))));
    b.addEventListener('click', function () {
      use(identity.id);
    });
    return b;
  }

  // The cards can be shown in more than one place: the first screen, and the advanced mode's entry (task 2.9).
  var lists = [];

  function fill(list) {
    list.textContent = '';
    ranked().forEach(function (r, i) {
      var fits = r.score > 0;
      list.appendChild(card(r.identity, fits && i < SHOW_WHY ? r : null, fits && i === 0));
    });
  }

  function anyFit() {
    return ranked().some(function (r) {
      return r.score > 0;
    });
  }

  function render() {
    lists.forEach(fill);
    els.empty.hidden = ready().length > 0;
    els.ranked.hidden = !anyFit();
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
    els.ranked = document.getElementById('identity-ranked');
    lists.push(document.getElementById('identity-list'));
    render();
    document.addEventListener('hawiya:state', mark);
    document.addEventListener('hawiya:lang', render);
    document.addEventListener('hawiya:session', render); // a session from the server can arrive after the start
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
