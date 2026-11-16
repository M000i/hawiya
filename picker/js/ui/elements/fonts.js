/*
 * Fonts gallery and the project language setting (task 2.11, R-043/R-030/R-090/R-094).
 * Browser: window.Hawiya.fonts (the font loader) and window.Hawiya.galleryParts.fonts.
 *
 * Font loader:
 *   fonts.load(families)          adds the Google Fonts stylesheet of each family once (the chosen font, for the preview)
 *   fonts.observe(node, families) loads them only when the node comes on screen (cards)
 *   fonts.requested()             families requested so far
 * If a stylesheet cannot load (no internet, blocked), the page shows a notice once; text keeps the system fonts
 * that follow every family in the stacks. Family names are checked (letters, digits, spaces, hyphens) before
 * they are put in a URL.
 *
 * Gallery part:
 *   before  the project language setting: Arabic only / English only / bilingual. It chooses the direction
 *           template with that direction (rtl / ltr / both), which sets the identity's language (resolve.js).
 *   cards   only the fonts for the project language: Arabic → fonts for Arabic; English → fonts for English;
 *           bilingual → fonts for both. Each card shows its specimen in the families it names (the Latin part
 *           drawn at the pair's size adjustment, R-090) and its numerals font with the digits it draws (R-094).
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  var NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,58}[A-Za-z0-9])?$/;
  var requested = {};
  var observer = null;
  var failed = false;

  function notify() {
    var n = document.getElementById('fonts-offline');
    if (n) n.hidden = false;
  }

  function load(families) {
    (families || []).forEach(function (name) {
      if (typeof name !== 'string' || !NAME.test(name) || requested[name]) return;
      requested[name] = true;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + name.replace(/ /g, '+') + ':wght@400;700&display=swap';
      link.setAttribute('data-font', name);
      link.addEventListener('error', function () {
        failed = true;
        notify();
      });
      document.head.appendChild(link);
    });
  }

  function observe(node, families) {
    if (typeof IntersectionObserver !== 'function') return load(families);
    if (!observer) {
      observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            observer.unobserve(e.target);
            load(e.target.__hawiyaFamilies);
          });
        },
        { rootMargin: '64px' }
      );
    }
    node.__hawiyaFamilies = families;
    observer.observe(node);
  }

  H.fonts = {
    load: load,
    observe: observe,
    requested: function () {
      return Object.keys(requested);
    },
    failed: function () {
      return failed;
    }
  };

  window.addEventListener('offline', notify);

  /* ---------- gallery part ---------- */

  var LANGS = [
    { id: 'ar', dir: 'rtl', key: 'fonts.project.ar' },
    { id: 'en', dir: 'ltr', key: 'fonts.project.en' },
    { id: 'ar+en', dir: 'both', key: 'fonts.project.both' }
  ];

  // Every family a font template names: body, heading (task 3.8) and numerals; their files load together.
  function families(tpl) {
    var ex = tpl.extras || {};
    return [ex.arabic, ex.latin, ex.headingArabic, ex.headingLatin, ex.numeralsFont].filter(function (n, i, all) {
      return typeof n === 'string' && NAME.test(n) && all.indexOf(n) === i;
    });
  }

  function stack(names) {
    return names
      .map(function (n) {
        return '"' + n + '"';
      })
      .concat(['system-ui', 'sans-serif'])
      .join(', ');
  }

  /* Is this font for the project language? */
  function fits(tpl, language) {
    var l = (tpl.extras && tpl.extras.languages) || [];
    if (language === 'ar') return l.indexOf('ar') !== -1;
    if (language === 'en') return l.indexOf('en') !== -1;
    return l.indexOf('ar') !== -1 && l.indexOf('en') !== -1;
  }

  function eastern() {
    var s = '';
    for (var i = 0; i < 10; i++) s += String.fromCharCode(0x0660 + i);
    return s;
  }

  function setProjectLanguage(ctx, lang) {
    // The direction templates live in their own data file; load it before choosing one.
    return H.library.load('direction').then(function () {
      var target = null;
      H.library.view().templates.direction.forEach(function (t) {
        if (!target && t.tokens && t.tokens.direction && t.tokens.direction.$value === lang.dir) target = t;
      });
      if (!target) return false;
      return ctx.change(function (c) {
        var keep = c.selections.direction.overrides; // numerals and calendar stay as chosen
        c.selections.direction = { template: target.id };
        if (keep) c.selections.direction.overrides = keep;
      });
    });
  }

  H.galleryParts.fonts = {
    sample: function (tpl, ctx) {
      var ex = tpl.extras || {};
      var box = ctx.el('span', 'g-sample f-sample');
      var names = families(tpl);
      // A pair with its own heading families shows them first, bold, on the same specimen text (task 3.8).
      [
        [ex.headingArabic, 'ar', 'fonts.specimen.ar'],
        [ex.headingLatin, 'en', 'fonts.specimen.latin']
      ].forEach(function (h) {
        if (typeof h[0] !== 'string' || !NAME.test(h[0])) return;
        var head = ctx.el('span', 'f-heading', ctx.t(h[2]));
        head.setAttribute('lang', h[1]);
        head.setAttribute('data-heading', h[0]);
        head.style.fontFamily = stack([h[0]]);
        box.appendChild(head);
      });
      if (ex.arabic) {
        var a = ctx.el('span', 'f-ar', ctx.t('fonts.specimen.ar'));
        a.setAttribute('lang', 'ar');
        a.style.fontFamily = stack([ex.arabic]);
        box.appendChild(a);
      }
      if (ex.latin && ex.latin !== ex.arabic) {
        var l = ctx.el('span', 'f-latin', ctx.t('fonts.specimen.latin'));
        l.setAttribute('lang', 'en');
        l.style.fontFamily = stack([ex.latin]);
        // R-090: the Latin family drawn at the pair's size adjustment, as the exported files ask.
        if (typeof ex.latinSizeAdjust === 'number') l.style.setProperty('--f-adjust', String(ex.latinSizeAdjust));
        l.setAttribute('data-size-adjust', String(ex.latinSizeAdjust));
        box.appendChild(l);
      } else if (ex.latin) {
        var same = ctx.el('span', 'f-latin', ctx.t('fonts.specimen.latin'));
        same.setAttribute('lang', 'en');
        same.style.fontFamily = stack([ex.latin]);
        box.appendChild(same);
      }
      // R-094: the numerals font, with the digits it draws.
      var numerals = typeof ex.numeralsFont === 'string' && NAME.test(ex.numeralsFont) ? ex.numeralsFont : names[0];
      var latinDigits = '0123456789';
      var digits = ctx.el('span', 'f-digits', latinDigits + (ex.easternArabicDigits ? ' ' + eastern() : ''));
      digits.setAttribute('dir', 'ltr');
      digits.style.fontFamily = stack([numerals]);
      digits.setAttribute('data-numerals', numerals);
      box.appendChild(digits);
      var meta = ctx.el('span', 'f-meta', ctx.t('fonts.numerals', { font: numerals }));
      meta.setAttribute('dir', 'auto');
      box.appendChild(meta);
      var fam = ctx.el('span', 'f-families', names.join(' + '));
      fam.setAttribute('dir', 'ltr');
      box.appendChild(fam);
      // Load this font's files only when its card is on screen.
      observe(box, names);
      return box;
    },

    before: function (ctx) {
      var box = ctx.el('div', 'f-project');
      var title = ctx.el('p', 'c-title');
      title.setAttribute('data-i18n', 'fonts.project.label');
      title.textContent = ctx.t('fonts.project.label');
      box.appendChild(title);
      var seg = ctx.el('div', 'seg f-langs');
      seg.setAttribute('role', 'group');
      seg.setAttribute('data-i18n-attr', 'aria-label:fonts.project.label');
      seg.setAttribute('aria-label', ctx.t('fonts.project.label'));
      LANGS.forEach(function (lang) {
        var b = ctx.el('button');
        b.type = 'button';
        b.setAttribute('data-project-lang', lang.id);
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('data-i18n', lang.key);
        b.textContent = ctx.t(lang.key);
        b.addEventListener('click', function () {
          setProjectLanguage(ctx, lang);
        });
        seg.appendChild(b);
      });
      box.appendChild(seg);
      return box;
    },

    after: function (ctx) {
      var empty = ctx.el('p', 'note f-empty');
      empty.setAttribute('data-i18n', 'fonts.none');
      empty.textContent = ctx.t('fonts.none');
      return empty;
    },

    update: function (panel, ctx) {
      var language = ctx.identity.project.language;
      Array.prototype.forEach.call(panel.querySelectorAll('[data-project-lang]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-project-lang') === language));
      });
      var shown = 0;
      Array.prototype.forEach.call(panel.querySelectorAll('[data-template]'), function (card) {
        var tpl = ctx.template(card.getAttribute('data-template'));
        var ok = !!tpl && fits(tpl, language);
        card.hidden = !ok;
        if (ok) shown++;
      });
      var empty = panel.querySelector('.f-empty');
      if (empty) empty.hidden = shown > 0;
    }
  };
})();
