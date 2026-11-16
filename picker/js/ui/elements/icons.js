/*
 * Icons: drawing a sample icon, and the icons gallery (task 2.12, R-047/R-093).
 * Browser: window.Hawiya.icons and window.Hawiya.galleryParts.icons.
 *
 *   icons.render(template, meaning, { fill, container, mirror })  → an element, or null
 *     The icon comes from the template's own samples (library/elements/icons.json, copied by
 *     tools/icons-extract.js): nothing is requested from the internet. Its shapes are rebuilt from an allow-list
 *     (plain SVG shapes and paint attributes only). fill falls back to outline when the set has no such variant;
 *     container wraps it (none / circle / square / rounded); mirror is the identity's list of meanings that turn
 *     around in right-to-left text (arrows, chevrons, undo), never clock, play or check (R-093).
 *
 * Gallery: one card per template (set × weight) with all 14 sample icons; the fill and container settings below
 * become the identity's adjustments; a strip shows the chosen icons as they will be used.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  var SVG = 'http://www.w3.org/2000/svg';
  var SHAPES = { path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, g: 1 };
  var ATTRS = {
    d: 1,
    cx: 1,
    cy: 1,
    r: 1,
    rx: 1,
    ry: 1,
    x: 1,
    y: 1,
    x1: 1,
    y1: 1,
    x2: 1,
    y2: 1,
    width: 1,
    height: 1,
    points: 1,
    fill: 1,
    stroke: 1,
    'stroke-width': 1,
    'stroke-linecap': 1,
    'stroke-linejoin': 1,
    opacity: 1,
    'fill-opacity': 1,
    'fill-rule': 1,
    'clip-rule': 1
  };
  var VIEWBOX = /^0 0 \d{1,4} \d{1,4}$/;

  /* The template's shapes, rebuilt node by node from the allow-list (never inserted as markup). */
  function shapes(body) {
    var doc = new DOMParser().parseFromString('<svg xmlns="' + SVG + '">' + body + '</svg>', 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    function copy(src) {
      if (!SHAPES[src.localName] || src.namespaceURI !== SVG) return null;
      var n = document.createElementNS(SVG, src.localName);
      Array.prototype.forEach.call(src.attributes, function (a) {
        if (ATTRS[a.name] && !/url\(|javascript:|[<>]/i.test(a.value)) n.setAttribute(a.name, a.value);
      });
      Array.prototype.forEach.call(src.children, function (c) {
        var k = copy(c);
        if (k) n.appendChild(k);
      });
      return n;
    }
    var out = [];
    Array.prototype.forEach.call(doc.documentElement.children, function (c) {
      var k = copy(c);
      if (k) out.push(k);
    });
    return out;
  }

  function samplesOf(tpl, fill) {
    var s = tpl && tpl.extras && tpl.extras.samples;
    if (!s) return null;
    return s[fill] || s.outline || null;
  }

  function render(tpl, meaning, opts) {
    var o = opts || {};
    var list = samplesOf(tpl, o.fill || 'outline');
    var sample = null;
    (list || []).forEach(function (x) {
      if (x.meaning === meaning) sample = x;
    });
    if (!sample) return null;
    var vb = tpl.extras.viewBox;
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', VIEWBOX.test(vb) ? vb : '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    shapes(sample.body).forEach(function (n) {
      svg.appendChild(n);
    });
    // Stroke sets draw every weight with the template's stroke width (Lucide light = 1.5).
    var sw = tpl.tokens && tpl.tokens.icon && tpl.tokens.icon.strokeWidth && tpl.tokens.icon.strokeWidth.$value;
    if (typeof sw === 'number' && tpl.extras.library !== 'phosphor') {
      Array.prototype.forEach.call(svg.querySelectorAll('[stroke-width]'), function (n) {
        n.setAttribute('stroke-width', String(sw));
      });
    }
    var wrap = document.createElement('span');
    var container = ['circle', 'square', 'rounded'].indexOf(o.container) !== -1 ? o.container : 'none';
    wrap.className = 'hw-icon hw-icon--' + container;
    wrap.setAttribute('data-meaning', meaning);
    if ((o.mirror || []).indexOf(meaning) !== -1) wrap.setAttribute('data-mirror', 'true');
    wrap.appendChild(svg);
    return wrap;
  }

  H.icons = {
    render: render,
    MEANINGS: [
      'arrow',
      'chevron',
      'undo',
      'search',
      'home',
      'settings',
      'user',
      'bell',
      'plus',
      'close',
      'menu',
      'check',
      'clock',
      'play'
    ]
  };

  /* ---------- gallery part ---------- */

  var FILLS = [
    { id: 'outline', key: 'icons.fill.outline' },
    { id: 'filled', key: 'icons.fill.filled' },
    { id: 'duotone', key: 'icons.fill.duotone' }
  ];
  var CONTAINERS = [
    { id: 'none', key: 'icons.container.none' },
    { id: 'circle', key: 'icons.container.circle' },
    { id: 'square', key: 'icons.container.square' },
    { id: 'rounded', key: 'icons.container.rounded' }
  ];
  var STRIP = ['arrow', 'chevron', 'undo', 'check', 'clock', 'play'];

  function setAdjust(ctx, name, value) {
    return ctx.change(function (c) {
      var s = c.selections.icons;
      var tpl = ctx.template(s.template);
      var own = tpl && tpl.extras ? tpl.extras[name] : null;
      var ov = s.overrides || {};
      if (value === own) delete ov[name];
      else ov[name] = value;
      if (Object.keys(ov).length) s.overrides = ov;
      else delete s.overrides;
    });
  }

  H.galleryParts.icons = {
    sample: function (tpl, ctx) {
      var grid = ctx.el('span', 'g-sample i-grid');
      H.icons.MEANINGS.forEach(function (m) {
        var icon = render(tpl, m, { fill: 'outline' });
        if (icon) grid.appendChild(icon);
      });
      return grid;
    },

    after: function (ctx) {
      var box = ctx.el('div', 'i-settings');
      box.appendChild(
        H.gallery.segment(ctx, {
          key: 'icons.fill.label',
          items: FILLS,
          attr: 'data-icon-fill',
          pick: function (v) {
            setAdjust(ctx, 'fill', v);
          }
        })
      );
      box.appendChild(
        H.gallery.segment(ctx, {
          key: 'icons.container.label',
          items: CONTAINERS,
          attr: 'data-icon-container',
          pick: function (v) {
            setAdjust(ctx, 'container', v);
          }
        })
      );
      var strip = ctx.el('div', 'i-strip');
      strip.setAttribute('data-icon-strip', 'true');
      box.appendChild(strip);
      var note = ctx.el('p', 'note');
      note.setAttribute('data-i18n', 'icons.mirrorNote');
      note.textContent = ctx.t('icons.mirrorNote');
      box.appendChild(note);
      return box;
    },

    update: function (panel, ctx) {
      var ext = ctx.identity.extensions;
      var tpl = ctx.template(ctx.choices.selections.icons.template);
      var samples = (tpl && tpl.extras && tpl.extras.samples) || {};
      Array.prototype.forEach.call(panel.querySelectorAll('[data-icon-fill]'), function (b) {
        var f = b.getAttribute('data-icon-fill');
        b.setAttribute('aria-pressed', String(f === ext.icons.fill));
        // Only the fills this set draws in this weight can be chosen.
        b.disabled = !samples[f];
      });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-icon-container]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-icon-container') === ext.icons.container));
      });
      var strip = panel.querySelector('[data-icon-strip]');
      if (strip && tpl) {
        strip.textContent = '';
        STRIP.forEach(function (m) {
          var icon = render(tpl, m, { fill: ext.icons.fill, container: ext.icons.container, mirror: ext.rtl.mirror });
          if (icon) strip.appendChild(icon);
        });
      }
    }
  };
})();
