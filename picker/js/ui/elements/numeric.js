/*
 * Gallery parts for the numeric elements (task 2.9, R-044/R-045/R-046/R-050): type scale, corners, shadows,
 * spacing. Browser: window.Hawiya.galleryParts[<element>] = { sample(template, ctx), sliders: [...] }.
 *
 * sample(template, ctx) draws a small picture of a template from its own library values (numbers and hex colors
 * only, set as style properties). Each slider adjusts the chosen template through the identity's allowed
 * adjustments (resolve.js): { key (i18n label), name (adjustment), min, max, step, unit, current(identity, choices),
 * base(template) }. The gallery drops an adjustment that equals the template's own value.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  function px(tok) {
    return tok && tok.$value && typeof tok.$value.value === 'number' ? tok.$value.value : 0;
  }
  function num(tok) {
    return tok && typeof tok.$value === 'number' ? tok.$value : 0;
  }
  function rgbOf(hex, alpha) {
    var n = parseInt(String(hex).slice(1), 16);
    if (!/^#[0-9a-fA-F]{6}$/.test(String(hex))) return 'rgb(0 0 0 / 0)';
    return (
      'rgb(' +
      ((n >> 16) & 255) +
      ' ' +
      ((n >> 8) & 255) +
      ' ' +
      (n & 255) +
      ' / ' +
      (typeof alpha === 'number' ? alpha : 1) +
      ')'
    );
  }
  function cssShadow(tok) {
    var layers = tok && Array.isArray(tok.$value) ? tok.$value : [];
    if (!layers.length) return 'none';
    return layers
      .map(function (l) {
        return (
          (l.inset ? 'inset ' : '') +
          [l.offsetX, l.offsetY, l.blur, l.spread]
            .map(function (d) {
              return (d && typeof d.value === 'number' ? d.value : 0) + 'px';
            })
            .join(' ') +
          ' ' +
          rgbOf(l.color && l.color.hex, l.color && l.color.alpha)
        );
      })
      .join(', ');
  }

  H.galleryParts['radius'] = {
    sample: function (t, ctx) {
      var box = ctx.el('span', 'g-sample g-radius');
      box.style.borderRadius = px(t.tokens.radius.md) + 'px';
      return box;
    },
    sliders: [
      { key: 'gallery.radius.sm', name: 'sm' },
      { key: 'gallery.radius.md', name: 'md' },
      { key: 'gallery.radius.lg', name: 'lg' }
    ].map(function (s) {
      return {
        key: s.key,
        name: s.name,
        min: 0,
        max: 64,
        step: 1,
        unit: 'px',
        current: function (id) {
          return id.tokens.radius[s.name];
        },
        base: function (t) {
          return px(t.tokens.radius[s.name]);
        }
      };
    })
  };

  H.galleryParts['type-scale'] = {
    sample: function (t, ctx) {
      var ts = t.tokens.typeScale;
      var wrap = ctx.el('span', 'g-sample g-type');
      var sizes;
      try {
        sizes = H.scale.generate({
          base: px(ts.base),
          ratio: num(ts.ratio),
          steps: num(ts.steps),
          below: num(ts.below)
        });
      } catch (e) {
        sizes = [];
      }
      var from = Math.max(0, sizes.indexOf(px(ts.base)));
      sizes.slice(from, from + 4).forEach(function (s) {
        var a = ctx.el('span', null, ctx.t('gallery.typeSample'));
        a.style.fontSize = Math.min(s, 40) / 16 + 'rem';
        wrap.appendChild(a);
      });
      return wrap;
    },
    sliders: [
      {
        key: 'gallery.type.base',
        name: 'base',
        min: 10,
        max: 32,
        step: 1,
        unit: 'px',
        current: function (id) {
          return id.tokens.typeScale.base;
        },
        base: function (t) {
          return px(t.tokens.typeScale.base);
        }
      },
      {
        key: 'gallery.type.ratio',
        name: 'ratio',
        min: 1.05,
        max: 2,
        step: 0.01,
        unit: '',
        current: function (id) {
          return id.tokens.typeScale.ratio;
        },
        base: function (t) {
          return num(t.tokens.typeScale.ratio);
        }
      },
      {
        key: 'gallery.type.lineHeightAr',
        name: 'line-height-ar',
        min: 1,
        max: 2.5,
        step: 0.05,
        unit: '',
        current: function (id) {
          return id.tokens.font.lineHeight.ar;
        },
        base: function (t) {
          return num(t.tokens.lineHeight && t.tokens.lineHeight.ar);
        }
      }
    ]
  };

  H.galleryParts['shadows'] = {
    sample: function (t, ctx) {
      var box = ctx.el('span', 'g-sample g-shadow');
      box.style.boxShadow = cssShadow(t.tokens.shadow.light.md);
      return box;
    },
    sliders: [
      {
        key: 'gallery.shadow.strength',
        name: 'strength',
        min: 0,
        max: 2,
        step: 0.1,
        unit: '',
        current: function (id, choices) {
          var o = choices.selections.shadows.overrides;
          return o && typeof o.strength === 'number' ? o.strength : 1;
        },
        base: function () {
          return 1;
        }
      }
    ]
  };

  H.galleryParts['spacing'] = {
    sample: function (t, ctx) {
      var wrap = ctx.el('span', 'g-sample g-spacing');
      var scale = t.tokens.spacing.scale || {};
      Object.keys(scale)
        .sort(function (a, b) {
          return Number(a) - Number(b);
        })
        .slice(1, 7)
        .forEach(function (k) {
          var bar = ctx.el('span', 'g-bar');
          bar.style.inlineSize = Math.min(px(scale[k]), 128) / 2 + 'px';
          wrap.appendChild(bar);
        });
      return wrap;
    },
    sliders: [
      {
        key: 'gallery.spacing.unit',
        name: 'unit',
        min: 2,
        max: 8,
        step: 1,
        unit: 'px',
        current: function (id) {
          return id.tokens.spacing.unit;
        },
        base: function (t) {
          return px(t.tokens.spacing.unit);
        }
      }
    ]
  };
})();
