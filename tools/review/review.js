/*
 * The library review page (task 3.4, R-061, R-065). Served by tools/review-server.js; never published.
 *
 * One element at a time: every template of it, drafts too, each drawn in the landing preview scene in the four
 * states (Arabic and English, light and dark), with the identity the first ready identity gives when this template
 * replaces its choice for the element (the picker's own drawing code: preview.sceneNodes, resolve, generate).
 * «Approve» and «Return to draft» ask the server to change the status in the library file; the counters follow.
 * A template the check finds problems in shows them and cannot be approved (the server refuses it too).
 * Everything from the library is written with textContent / setAttribute; recipes are rebuilt by preview.js from
 * the allow-list. The token comes from the address (#token=...) and is removed from the address bar at once.
 */
(function () {
  'use strict';

  var H = window.Hawiya;
  var R = window.HawiyaReview;
  var ELEMENTS = [
    'colors',
    'modes',
    'fonts',
    'type-scale',
    'radius',
    'shadows',
    'icons',
    'buttons',
    'cards',
    'spacing',
    'direction'
  ];
  var STATES = [
    { lang: 'ar', mode: 'light', key: 'stateArLight' },
    { lang: 'ar', mode: 'dark', key: 'stateArDark' },
    { lang: 'en', mode: 'light', key: 'stateEnLight' },
    { lang: 'en', mode: 'dark', key: 'stateEnDark' }
  ];
  var EASTERN = '٠١٢٣٤٥٦٧٨٩';

  var m = /(?:^#|&)token=([A-Za-z0-9_-]{20,256})(?:&|$)/.exec(location.hash);
  var token = m ? m[1] : null;
  if (token) history.replaceState(null, '', location.pathname);

  var lang = 'ar';
  try {
    if (localStorage.getItem('hawiya.review.lang') === 'en') lang = 'en';
  } catch (e) {
    /* storage blocked: Arabic */
  }
  var data = { elements: {}, identities: [], problems: {} };
  var current = 'colors';
  var observer = null;

  function t(key, params) {
    var s = (R.text[lang] && R.text[lang][key]) || R.text.ar[key] || key;
    return s.replace(/\{([a-z]+)\}/g, function (all, k) {
      return params && Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : all;
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function say(text, kind) {
    var box = document.getElementById('r-message');
    box.textContent = text || '';
    if (kind) box.setAttribute('data-kind', kind);
    else box.removeAttribute('data-kind');
  }

  function api(path, body) {
    var init = { headers: { 'X-Hawiya-Token': token || '' }, cache: 'no-store' };
    if (body) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().then(
        function (json) {
          return { status: res.status, body: json };
        },
        function () {
          return { status: res.status, body: {} };
        }
      );
    });
  }

  /* ---------- counts ---------- */

  // An entry of an element file that is a template-like object (a broken one is shown, never counted).
  function isEntry(tpl) {
    return !!tpl && typeof tpl === 'object' && !Array.isArray(tpl) && typeof tpl.id === 'string';
  }

  // The entries the picker's code may read (library.find, resolve): template-like objects only.
  function clean(list) {
    return (Array.isArray(list) ? list : []).filter(isEntry);
  }

  function stateOf(tpl) {
    return tpl && tpl.status && tpl.status.state === 'reviewed' ? 'reviewed' : 'draft';
  }

  function count(list) {
    var c = { reviewed: 0, drafts: 0 };
    clean(list).forEach(function (tpl) {
      if (stateOf(tpl) === 'reviewed') c.reviewed++;
      else c.drafts++;
    });
    return c;
  }

  function renderCounts() {
    var all = { reviewed: 0, drafts: 0 };
    ELEMENTS.forEach(function (e) {
      var c = count(data.elements[e]);
      all.reviewed += c.reviewed;
      all.drafts += c.drafts;
    });
    document.getElementById('count-reviewed').textContent = String(all.reviewed);
    document.getElementById('count-drafts').textContent = String(all.drafts);
  }

  /* ---------- interface language ---------- */

  function applyLang() {
    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('title');
    document.getElementById('r-title').textContent = t('title');
    document.getElementById('r-lang').textContent = t('langToggle');
    document.getElementById('r-tabs').setAttribute('aria-label', t('elementsLabel'));
    Array.prototype.forEach.call(document.querySelectorAll('[data-text]'), function (n) {
      n.textContent = t(n.getAttribute('data-text'));
    });
  }

  /* ---------- tabs ---------- */

  function renderTabs() {
    var nav = document.getElementById('r-tabs');
    nav.textContent = '';
    ELEMENTS.forEach(function (e) {
      var c = count(data.elements[e]);
      var b = el('button', 'r-tab');
      b.type = 'button';
      b.setAttribute('data-element', e);
      b.setAttribute('aria-current', e === current ? 'true' : 'false');
      b.appendChild(document.createTextNode(t('element.' + e) + ' '));
      var small = el(
        'small',
        null,
        c.reviewed + '/' + (c.reviewed + c.drafts) + (data.errors && data.errors[e] ? ' ⚠' : '')
      );
      small.setAttribute('data-tab-count', e);
      b.appendChild(small);
      b.addEventListener('click', function () {
        current = e;
        say('');
        renderTabs();
        renderList();
      });
      nav.appendChild(b);
    });
  }

  /* ---------- identities ---------- */

  // The first ready identity's choices, with any missing choice taken from the first template of its element.
  function baseSelections() {
    var first = data.identities[0];
    var sel = {};
    ELEMENTS.forEach(function (e) {
      var list = clean(data.elements[e]);
      var id = first && first.templates && first.templates[e];
      var found = list.some(function (x) {
        return x.id === id;
      });
      if (!found) id = list[0] && list[0].id;
      if (id) sel[e] = { template: id };
    });
    return sel;
  }

  function identityFor(element, tpl) {
    var sel = baseSelections();
    sel[element] = { template: tpl.id };
    return H.resolve.resolve({ name: 'Hawiya', selections: sel }, { templates: H.data.templates });
  }

  function fontFamilies(identity) {
    var f = H.library.find('fonts', identity.selections.fonts && identity.selections.fonts.template);
    var ex = (f && f.extras) || {};
    return [ex.arabic, ex.latin].filter(function (n, i, all) {
      return n && all.indexOf(n) === i;
    });
  }

  /* ---------- one template ---------- */

  function drawState(host, identity, s) {
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.textContent = '';
    var nodes = H.preview.sceneNodes(identity, s.lang, s.mode, 'landing');
    if (!nodes) return;
    root.appendChild(nodes[0]);
    root.appendChild(nodes[1]);
    host.setAttribute('data-drawn', 'true');
  }

  function extraFor(element, tpl) {
    var box = el('div', 'r-extra');
    var ex = tpl.extras || {};
    if (element === 'icons' && H.icons) {
      box.appendChild(el('span', 'r-meta', t('icons')));
      H.icons.MEANINGS.forEach(function (meaning) {
        var icon = H.icons.render(tpl, meaning, {
          fill: ex.fill === 'filled' || ex.fill === 'duotone' ? ex.fill : 'outline'
        });
        if (icon) box.appendChild(icon);
      });
    } else if (element === 'fonts') {
      box.appendChild(el('span', 'r-meta', t('digits')));
      var digits = el('span', null, '0123456789' + (ex.easternArabicDigits ? '  ' + EASTERN : ''));
      digits.setAttribute('dir', 'ltr');
      var family = typeof ex.numeralsFont === 'string' ? ex.numeralsFont : ex.arabic || ex.latin;
      if (family && /^[A-Za-z0-9 -]{1,60}$/.test(family))
        digits.style.fontFamily = '"' + family + '", system-ui, sans-serif';
      box.appendChild(digits);
    } else if (element === 'modes') {
      var d = tpl.tokens && tpl.tokens.mode && tpl.tokens.mode.default && tpl.tokens.mode.default.$value;
      box.appendChild(el('span', 'r-meta', t('defaultMode', { mode: String(d) })));
    } else if (element === 'direction') {
      var dir = tpl.tokens && tpl.tokens.direction && tpl.tokens.direction.$value;
      box.appendChild(
        el(
          'span',
          'r-meta',
          t('directionInfo', { dir: String(dir), numerals: String(ex.numerals), calendar: String(ex.calendar) })
        )
      );
    }
    return box.childNodes.length ? box : null;
  }

  function renderCard(element, tpl) {
    var card = el('article', 'r-card');
    card.setAttribute('data-template', tpl.id);
    card.setAttribute('data-state', stateOf(tpl));

    var head = el('div', 'r-card-head');
    var name = (tpl.name && (tpl.name[lang] || tpl.name.ar)) || tpl.id;
    var other = tpl.name && tpl.name[lang === 'ar' ? 'en' : 'ar'];
    var h = el('h2', null, name);
    head.appendChild(h);
    if (other) {
      var o = el('span', 'r-meta', other);
      o.setAttribute('lang', lang === 'ar' ? 'en' : 'ar');
      o.setAttribute('dir', 'auto');
      head.appendChild(o);
    }
    head.appendChild(el('span', 'r-id', tpl.id));
    var st = stateOf(tpl);
    var badge = el(
      'span',
      'r-status',
      st === 'reviewed' ? t('statusReviewed', { date: tpl.status.reviewedAt || '' }) : t('statusDraft')
    );
    badge.setAttribute('data-state', st);
    head.appendChild(badge);

    var problems = data.problems[element + '/' + tpl.id] || [];
    var actions = el('div', 'r-actions');
    var approve = el('button', 'r-btn', t('approve'));
    approve.type = 'button';
    approve.setAttribute('data-action', 'approve');
    approve.disabled = st === 'reviewed' || problems.length > 0;
    approve.addEventListener('click', function () {
      change(element, tpl, 'reviewed');
    });
    var back = el('button', 'r-btn', t('toDraft'));
    back.type = 'button';
    back.setAttribute('data-action', 'draft');
    back.disabled = st === 'draft';
    back.addEventListener('click', function () {
      change(element, tpl, 'draft');
    });
    actions.appendChild(approve);
    actions.appendChild(back);
    head.appendChild(actions);
    card.appendChild(head);

    var meta = el('p', 'r-meta');
    meta.textContent =
      t('kind') +
      ': ' +
      tpl.kind +
      ' · ' +
      t('tags') +
      ': ' +
      (Array.isArray(tpl.tags) ? tpl.tags.join(', ') : String(tpl.tags)) +
      ' · ' +
      t('source') +
      ': ' +
      (tpl.source ? tpl.source.name + ' (' + tpl.source.license + ')' : '—');
    card.appendChild(meta);

    if (problems.length) {
      var pbox = el('div', 'r-problems');
      pbox.setAttribute('data-problems', String(problems.length));
      pbox.appendChild(el('p', null, t('problems')));
      var ul = el('ul');
      problems.forEach(function (p) {
        var li = el('li', null, '[' + p.kind + '] ' + p.message);
        li.setAttribute('dir', 'ltr');
        ul.appendChild(li);
      });
      pbox.appendChild(ul);
      card.appendChild(pbox);
    }

    var extra = extraFor(element, tpl);
    if (extra) card.appendChild(extra);

    var identity = null;
    try {
      identity = identityFor(element, tpl);
    } catch (e) {
      var why = e && e.problems ? e.problems.slice(0, 3).join('; ') : (e && e.message) || String(e);
      var err = el('p', 'r-problems', t('noIdentity', { why: why }));
      err.setAttribute('data-no-identity', 'true');
      card.appendChild(err);
    }
    if (identity) {
      var grid = el('div', 'r-states');
      STATES.forEach(function (s) {
        var fig = el('figure', 'r-state');
        fig.appendChild(el('figcaption', null, t(s.key)));
        var host = el('div', 'r-scene');
        host.setAttribute('data-lang', s.lang);
        host.setAttribute('data-mode', s.mode);
        host.reviewDraw = function () {
          if (H.fonts) H.fonts.load(fontFamilies(identity));
          drawState(host, identity, s);
        };
        fig.appendChild(host);
        grid.appendChild(fig);
        if (observer) observer.observe(host);
        else host.reviewDraw();
      });
      card.appendChild(grid);
    }
    return card;
  }

  function renderList() {
    var list = document.getElementById('r-list');
    list.textContent = '';
    if (observer) observer.disconnect();
    if (data.errors && data.errors[current]) {
      var fe = el('p', 'r-problems', t('fileError', { why: data.errors[current] }));
      fe.setAttribute('data-file-error', 'true');
      list.appendChild(fe);
    }
    var templates = Array.isArray(data.elements[current]) ? data.elements[current] : [];
    if (!templates.length) {
      list.appendChild(el('p', 'r-meta', t('empty')));
      return;
    }
    // One broken entry never hides the others: it gets a card that says what is wrong.
    templates.forEach(function (tpl, i) {
      var card = null;
      var why = null;
      if (isEntry(tpl)) {
        try {
          card = renderCard(current, tpl);
        } catch (e) {
          why = (e && e.message) || String(e);
        }
      } else why = 'not a template object';
      if (!card) {
        card = el('article', 'r-card');
        card.setAttribute('data-broken', String(i + 1));
        var p = el('p', 'r-problems', t('broken', { n: i + 1, id: isEntry(tpl) ? tpl.id : '—', why: why }));
        p.setAttribute('dir', 'auto');
        card.appendChild(p);
      }
      list.appendChild(card);
    });
  }

  function replaceCard(element, tpl) {
    var old = document.querySelector('.r-card[data-template="' + CSS.escape(tpl.id) + '"]');
    if (!old || element !== current) return;
    try {
      old.replaceWith(renderCard(element, tpl));
    } catch (e) {
      renderList(); // the list draws a broken card for it
    }
  }

  /* ---------- approve / back to draft ---------- */

  function change(element, tpl, state) {
    var name = (tpl.name && (tpl.name[lang] || tpl.name.ar)) || tpl.id;
    var fp = data.fingerprints && data.fingerprints[element + '/' + tpl.id];
    api('/api/status', { element: element, id: tpl.id, state: state, from: stateOf(tpl), fingerprint: fp || '' }).then(
      function (r) {
        if (r.status === 200) {
          tpl.status = r.body.status;
          say(t('saved', { name: name, state: t(state === 'reviewed' ? 'reviewed' : 'drafts') }));
        } else if (r.status === 409 && r.body.error === 'problems') {
          data.problems[element + '/' + tpl.id] = r.body.problems || [];
          say(t('blocked', { name: name }), 'bad');
        } else if (r.status === 409 && r.body.error === 'duplicate id') {
          say(t('duplicate', { id: tpl.id }), 'bad');
        } else if (r.status === 409 && r.body.error === 'changed') {
          say(t('changed'), 'bad');
        } else if (r.status === 401 || r.status === 403) {
          say(t('closed'), 'bad');
        } else {
          say(t('failed', { why: r.body.error || r.status }), 'bad');
        }
        renderCounts();
        renderTabs();
        replaceCard(element, tpl);
      },
      function () {
        say(t('closed'), 'bad');
      }
    );
  }

  /* ---------- start ---------- */

  function start() {
    applyLang();
    document.getElementById('r-lang').addEventListener('click', function () {
      lang = lang === 'ar' ? 'en' : 'ar';
      try {
        localStorage.setItem('hawiya.review.lang', lang);
      } catch (e) {
        /* not remembered */
      }
      applyLang();
      renderTabs();
      renderList();
    });
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting && en.target.reviewDraw) {
              observer.unobserve(en.target);
              en.target.reviewDraw();
            }
          });
        },
        { rootMargin: '400px' }
      );
    }
    if (!token) {
      say(t('noToken'), 'bad');
      return;
    }
    say(t('loading'));
    api('/api/library').then(
      function (r) {
        if (r.status !== 200) {
          say(
            r.status === 401 || r.status === 403 ? t('closed') : t('loadFailed', { why: r.body.error || r.status }),
            'bad'
          );
          return;
        }
        data = r.body;
        var templates = {};
        ELEMENTS.forEach(function (e) {
          templates[e] = clean(data.elements[e]);
        });
        H.data = { templates: templates, identities: data.identities };
        say('');
        renderCounts();
        renderTabs();
        renderList();
        document.documentElement.setAttribute('data-ready', 'true');
      },
      function () {
        say(t('closed'), 'bad');
      }
    );
  }

  start();
})();
