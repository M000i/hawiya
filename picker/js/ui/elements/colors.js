/*
 * Colors gallery (task 2.10, R-041/R-081). Browser: window.Hawiya.galleryParts.colors.
 *
 * - Cards: the library palettes, each pictured by its two colors.
 * - First suggestion: the brand colors of the session (window.Hawiya.session.brandColors, read in task 2.20),
 *   when there are any: one click makes the first the primary and the second the secondary.
 * - One color: type #RRGGBB (or pick it); it becomes the primary adjustment of the chosen palette, and the
 *   identity derives everything from it (ramps, neutrals, both modes, status colors: modes.js, tasks 1.4/1.5).
 *   An optional second color replaces the palette's secondary; empty keeps the palette's.
 * - Result: the 11 steps of the primary, secondary and neutral ramps and the four status colors, read from the
 *   built identity (so what is shown is what is exported).
 * Colors come only from checked #rrggbb values and are set as style properties; nothing is written as HTML.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  var HEX = /^#?([0-9a-fA-F]{6})$/;
  var STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
  var RAMPS = [
    { id: 'primary', key: 'gallery.colors.ramp.primary' },
    { id: 'secondary', key: 'gallery.colors.ramp.secondary' },
    { id: 'neutral', key: 'gallery.colors.ramp.neutral' }
  ];
  var STATUS = [
    { id: 'success', key: 'gallery.colors.success' },
    { id: 'warning', key: 'gallery.colors.warning' },
    { id: 'danger', key: 'gallery.colors.danger' },
    { id: 'info', key: 'gallery.colors.info' }
  ];

  function hex(v) {
    var m = HEX.exec(String(v == null ? '' : v).trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }

  function templateColor(tpl, role) {
    var tok = tpl && tpl.tokens && tpl.tokens.color && tpl.tokens.color[role];
    return tok && tok.$value ? hex(tok.$value.hex) : null;
  }

  /* Set or drop a color adjustment of the chosen palette (dropped when it equals the palette's own). */
  function setColor(ctx, role, value) {
    return ctx.change(function (c) {
      var s = c.selections.colors;
      var own = templateColor(ctx.template(s.template), role);
      var ov = s.overrides || {};
      if (!value || value === own) delete ov[role];
      else ov[role] = value;
      if (Object.keys(ov).length) s.overrides = ov;
      else delete s.overrides;
    });
  }

  function swatch(ctx, color, label) {
    var sw = ctx.el('span', 'c-swatch');
    sw.style.backgroundColor = color;
    sw.setAttribute('data-hex', color);
    sw.setAttribute('title', label ? label + ' ' + color : color);
    return sw;
  }

  function brandColors() {
    var s = H.session;
    var list = s && Array.isArray(s.brandColors) ? s.brandColors : [];
    var out = [];
    list.forEach(function (c) {
      var h = hex(c);
      if (h && out.indexOf(h) === -1 && out.length < 3) out.push(h);
    });
    return out;
  }

  function colorField(ctx, f) {
    var role = f.role;
    var key = f.key;
    var optional = f.optional;
    var wrap = ctx.el('div', 'c-field');
    var id = 'c-input-' + role;
    var label = ctx.el('label', 'c-label');
    label.setAttribute('for', id);
    label.setAttribute('data-i18n', key);
    label.textContent = ctx.t(key);
    var row = ctx.el('div', 'c-row');
    var text = ctx.el('input', 'c-text');
    text.type = 'text';
    text.id = id;
    text.setAttribute('dir', 'ltr');
    text.setAttribute('inputmode', 'text');
    text.setAttribute('autocomplete', 'off');
    text.setAttribute('spellcheck', 'false');
    text.setAttribute('maxlength', '7');
    text.setAttribute('data-color-input', role);
    text.setAttribute('placeholder', '#2563EB');
    var picker = ctx.el('input', 'c-picker');
    picker.type = 'color';
    picker.setAttribute('data-color-picker', role);
    picker.setAttribute('data-i18n-attr', 'aria-label:' + key);
    picker.setAttribute('aria-label', ctx.t(key));
    var error = ctx.el('p', 'field-error c-error');
    error.setAttribute('data-i18n', 'gallery.colors.invalid');
    error.textContent = ctx.t('gallery.colors.invalid');
    error.id = id + '-error';
    error.hidden = true;
    text.setAttribute('aria-describedby', error.id);

    text.addEventListener('input', function () {
      var raw = text.value.trim();
      var v = hex(raw);
      if (v) {
        error.hidden = true;
        text.removeAttribute('aria-invalid');
        setColor(ctx, role, v);
      } else if (optional && raw === '') {
        error.hidden = true;
        text.removeAttribute('aria-invalid');
        setColor(ctx, role, null);
      } else if (raw.replace('#', '').length >= 6) {
        // Only say "invalid" once a full value was typed, not on every keystroke.
        error.hidden = false;
        text.setAttribute('aria-invalid', 'true');
      } else {
        // Still typing (or correcting): no error until the value is complete again.
        error.hidden = true;
        text.removeAttribute('aria-invalid');
      }
    });
    picker.addEventListener('input', function () {
      var v = hex(picker.value);
      if (v) setColor(ctx, role, v);
    });
    row.appendChild(text);
    row.appendChild(picker);
    wrap.appendChild(label);
    wrap.appendChild(row);
    wrap.appendChild(error);
    return wrap;
  }

  H.galleryParts.colors = {
    sample: function (tpl, ctx) {
      var wrap = ctx.el('span', 'g-sample c-dots');
      ['primary', 'secondary'].forEach(function (role) {
        var c = templateColor(tpl, role);
        if (c) wrap.appendChild(swatch(ctx, c));
      });
      return wrap;
    },

    // Brand colors from the session come first, before the library palettes.
    before: function (ctx) {
      var brand = brandColors();
      var box = ctx.el('div', 'c-brand');
      box.hidden = brand.length === 0;
      if (!brand.length) return box;
      var title = ctx.el('p', 'c-title');
      title.setAttribute('data-i18n', 'gallery.colors.brand');
      title.textContent = ctx.t('gallery.colors.brand');
      box.appendChild(title);
      var b = ctx.el('button', 'g-card c-brand-card');
      b.type = 'button';
      b.setAttribute('data-brand', 'true');
      var dots = ctx.el('span', 'g-sample c-dots');
      brand.forEach(function (c) {
        dots.appendChild(swatch(ctx, c));
      });
      b.appendChild(dots);
      b.setAttribute('data-i18n-attr', 'aria-label:gallery.colors.useBrand');
      b.setAttribute('aria-label', ctx.t('gallery.colors.useBrand'));
      b.addEventListener('click', function () {
        ctx.change(function (c) {
          var s = c.selections.colors;
          var tpl = ctx.template(s.template);
          var ov = {};
          if (brand[0] !== templateColor(tpl, 'primary')) ov.primary = brand[0];
          if (brand[1] && brand[1] !== templateColor(tpl, 'secondary')) ov.secondary = brand[1];
          if (Object.keys(ov).length) s.overrides = ov;
          else delete s.overrides;
        });
      });
      box.appendChild(b);
      return box;
    },

    after: function (ctx) {
      var box = ctx.el('div', 'c-custom');
      // The project's contrast level: every text color must reach it in both modes (the blocking rules).
      box.appendChild(
        H.gallery.segment(ctx, {
          key: 'gallery.colors.level',
          items: [
            { id: 'AA', key: 'gallery.colors.level.AA' },
            { id: 'AAA', key: 'gallery.colors.level.AAA' }
          ],
          attr: 'data-contrast-level',
          pick: function (v) {
            ctx.change(function (c) {
              c.project = c.project || {};
              c.project.contrast = v;
            });
          }
        })
      );
      box.appendChild(colorField(ctx, { role: 'primary', key: 'gallery.colors.primary', optional: false }));
      box.appendChild(colorField(ctx, { role: 'secondary', key: 'gallery.colors.secondary', optional: true }));

      var result = ctx.el('div', 'c-result');
      var title = ctx.el('p', 'c-title');
      title.setAttribute('data-i18n', 'gallery.colors.ramps');
      title.textContent = ctx.t('gallery.colors.ramps');
      result.appendChild(title);
      RAMPS.forEach(function (r) {
        var row = ctx.el('div', 'c-ramp');
        row.setAttribute('data-ramp', r.id);
        var name = ctx.el('span', 'c-ramp-name');
        name.setAttribute('data-i18n', r.key);
        name.textContent = ctx.t(r.key);
        row.appendChild(name);
        row.appendChild(ctx.el('span', 'c-steps'));
        result.appendChild(row);
      });
      var st = ctx.el('div', 'c-ramp');
      st.setAttribute('data-ramp', 'status');
      var stName = ctx.el('span', 'c-ramp-name');
      stName.setAttribute('data-i18n', 'gallery.colors.status');
      stName.textContent = ctx.t('gallery.colors.status');
      st.appendChild(stName);
      st.appendChild(ctx.el('span', 'c-steps'));
      result.appendChild(st);
      box.appendChild(result);
      return box;
    },

    // Every change: the inputs and the generated colors show the built identity.
    update: function (panel, ctx) {
      var id = ctx.identity;
      var colors = id.tokens.color;
      Array.prototype.forEach.call(panel.querySelectorAll('[data-contrast-level]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-contrast-level') === id.project.contrast));
      });
      var ov = ctx.choices.selections.colors.overrides || {};
      var primary = panel.querySelector('[data-color-input="primary"]');
      var secondary = panel.querySelector('[data-color-input="secondary"]');
      var focused = document.activeElement;
      // Never rewrite a field while the user is typing in it.
      if (primary && focused !== primary) primary.value = colors.light.primary.toUpperCase();
      if (secondary && focused !== secondary) secondary.value = ov.secondary ? ov.secondary.toUpperCase() : '';
      var pp = panel.querySelector('[data-color-picker="primary"]');
      if (pp) pp.value = colors.light.primary;
      var sp = panel.querySelector('[data-color-picker="secondary"]');
      if (sp) sp.value = colors.light.secondary;

      RAMPS.forEach(function (r) {
        var steps = panel.querySelector('[data-ramp="' + r.id + '"] .c-steps');
        if (!steps) return;
        steps.textContent = '';
        colors.ramps[r.id].forEach(function (c, i) {
          steps.appendChild(swatch(ctx, c, STEPS[i]));
        });
      });
      var status = panel.querySelector('[data-ramp="status"] .c-steps');
      if (status) {
        status.textContent = '';
        STATUS.forEach(function (s) {
          var sw = swatch(ctx, colors.light[s.id], ctx.t(s.key));
          sw.setAttribute('data-status', s.id);
          status.appendChild(sw);
        });
      }
    }
  };
})();
