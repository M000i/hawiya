/*
 * Light and dark mode, and direction and language: two simple settings (task 2.13, R-042/R-051).
 * Browser: window.Hawiya.galleryParts.modes and window.Hawiya.galleryParts.direction.
 *
 * Modes: one card per template (follow the device / light first / dark first). Each card shows the identity's
 *   two modes side by side, the default one marked; every identity carries both modes in its files.
 * Direction: one card per template (Arabic RTL / English LTR / bilingual); changing it keeps the numerals and
 *   calendar chosen below. Numerals (Western or Eastern Arabic digits) and calendar (Gregorian / Hijri Umm al-Qura) are the
 *   template's adjustments; an example shows a number and a date as the identity writes them.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  function vars(identity, mode) {
    var out = {};
    H.generate.cssVariables(identity, mode).forEach(function (p) {
      out[p[0]] = p[1];
    });
    return out;
  }

  /* ---------- modes ---------- */

  function defaultOf(tpl) {
    var d = tpl && tpl.tokens && tpl.tokens.mode && tpl.tokens.mode.default;
    return d ? d.$value : 'system';
  }

  H.galleryParts.modes = {
    sample: function (tpl, ctx) {
      var box = ctx.el('span', 'g-sample m-sample');
      box.setAttribute('aria-hidden', 'true');
      var first = defaultOf(tpl) === 'dark' ? ['dark', 'light'] : ['light', 'dark'];
      // Without the light/dark switch (task 3.9) the app has one mode only: one swatch.
      var sw0 = tpl && tpl.tokens && tpl.tokens.mode && tpl.tokens.mode.switch;
      if (sw0 && sw0.$value === 'none') {
        first = [defaultOf(tpl) === 'dark' ? 'dark' : 'light'];
        box.setAttribute('data-switch', 'none');
      }
      first.forEach(function (m) {
        var sw = ctx.el('span', 'm-swatch');
        sw.setAttribute('data-swatch', m);
        if (defaultOf(tpl) === m) sw.setAttribute('data-default', 'true');
        sw.appendChild(ctx.el('span', 'm-dot'));
        box.appendChild(sw);
      });
      return box;
    },
    after: function (ctx) {
      var note = ctx.el('p', 'note');
      note.setAttribute('data-i18n', 'modes.note');
      note.textContent = ctx.t('modes.note');
      return note;
    },
    update: function (panel, ctx) {
      var light = vars(ctx.identity, 'light');
      var dark = vars(ctx.identity, 'dark');
      Array.prototype.forEach.call(panel.querySelectorAll('[data-swatch]'), function (sw) {
        var v = sw.getAttribute('data-swatch') === 'dark' ? dark : light;
        sw.style.background = v['--color-background'];
        sw.style.borderColor = v['--color-border'];
        sw.firstChild.style.background = v['--color-primary'];
      });
    }
  };

  /* ---------- direction ---------- */

  var NUMERALS = [
    { id: 'latn', key: 'direction.numerals.latn' },
    { id: 'arab', key: 'direction.numerals.arab' }
  ];
  var CALENDARS = [
    { id: 'gregory', key: 'direction.calendar.gregory' },
    { id: 'islamic-umalqura', key: 'direction.calendar.islamic' }
  ];
  var KEPT = ['numerals', 'calendar'];
  // A fixed day, so the example does not change from one day to the next.
  var DAY = new Date(Date.UTC(2026, 10, 16));

  function setAdjust(ctx, name, value) {
    return ctx.change(function (c) {
      var s = c.selections.direction;
      var tpl = ctx.template(s.template);
      var own = tpl && tpl.extras ? tpl.extras[name] : null;
      var ov = s.overrides || {};
      if (value === own) delete ov[name];
      else ov[name] = value;
      if (Object.keys(ov).length) s.overrides = ov;
      else delete s.overrides;
    });
  }

  function example(ext) {
    var locale = 'ar-u-nu-' + ext.numerals + '-ca-' + ext.calendar;
    try {
      var n = new Intl.NumberFormat(locale).format(1234.5);
      var d = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(DAY);
      return n + ' · ' + d;
    } catch (e) {
      return '';
    }
  }

  H.galleryParts.direction = {
    pick: function (c, tpl) {
      var old = c.selections.direction && c.selections.direction.overrides;
      var keep = {};
      KEPT.forEach(function (k) {
        if (old && Object.prototype.hasOwnProperty.call(old, k) && old[k] !== tpl.extras[k]) keep[k] = old[k];
      });
      c.selections.direction = { template: tpl.id };
      if (Object.keys(keep).length) c.selections.direction.overrides = keep;
    },
    after: function (ctx) {
      var box = ctx.el('div', 'i-settings');
      box.appendChild(
        H.gallery.segment(ctx, {
          key: 'direction.numerals.label',
          items: NUMERALS,
          attr: 'data-numerals',
          pick: function (v) {
            setAdjust(ctx, 'numerals', v);
          }
        })
      );
      box.appendChild(
        H.gallery.segment(ctx, {
          key: 'direction.calendar.label',
          items: CALENDARS,
          attr: 'data-calendar',
          pick: function (v) {
            setAdjust(ctx, 'calendar', v);
          }
        })
      );
      var ex = ctx.el('p', 'd-example');
      ex.setAttribute('data-direction-example', 'true');
      ex.setAttribute('lang', 'ar');
      ex.setAttribute('dir', 'rtl');
      box.appendChild(ex);
      return box;
    },
    update: function (panel, ctx) {
      var ext = ctx.identity.extensions;
      Array.prototype.forEach.call(panel.querySelectorAll('[data-numerals]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-numerals') === ext.numerals));
      });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-calendar]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-calendar') === ext.calendar));
      });
      var ex = panel.querySelector('[data-direction-example]');
      var text = example(ext);
      if (ex) ex.textContent = text;
    }
  };
})();
