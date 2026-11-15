/*
 * WCAG 2.x contrast (task 1.2, R-080). Works in the browser (window.Hawiya.contrast) and in Node.
 *
 * - Relative luminance per WCAG 2.2 / sRGB: channel <= 0.04045 → c/12.92, else ((c+0.055)/1.055)^2.4
 *   (WCAG 2.0 printed 0.03928; the two give identical results for 8-bit colors).
 * - ratio = (L_light + 0.05) / (L_dark + 0.05), from 1 to 21.
 * - Verdicts always use the exact ratio, never the rounded one: 4.499 still fails AA.
 *   Callers must pass the exact `ratio` to meets(), never `rounded`.
 * - Display (`rounded`): two decimals, except that it never shows a threshold (3, 4.5, 7) that the exact
 *   ratio does not reach — 4.496 is shown as 4.49, not 4.50, so "4.50:1 — blocked" can never appear.
 * - Thresholds (WCAG 1.4.3 / 1.4.6): normal text AA 4.5, AAA 7; large text AA 3, AAA 4.5.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.contrast = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THRESHOLDS = {
    normal: { AA: 4.5, AAA: 7 },
    large: { AA: 3, AAA: 4.5 }
  };

  /* Accepts #rgb or #rrggbb (any letter case). Returns [r, g, b] as 0..255 integers. */
  function parseHex(hex) {
    if (typeof hex !== 'string') throw new Error('Hawiya.contrast: color must be a string');
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
    if (!m) throw new Error('Hawiya.contrast: not a #rgb or #rrggbb color: ' + JSON.stringify(hex));
    var h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function channel(c8) {
    var c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var rgb = parseHex(hex);
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  }

  function ratio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Two decimals for display, as in spec.md section 12. */
  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function meets(exactRatio, level, large) {
    if (level !== 'AA' && level !== 'AAA') throw new Error('Hawiya.contrast: level must be "AA" or "AAA"');
    if (typeof exactRatio !== 'number' || !(exactRatio >= 1 && exactRatio <= 21)) {
      throw new Error('Hawiya.contrast: ratio must be a number from 1 to 21');
    }
    return exactRatio >= THRESHOLDS[large ? 'large' : 'normal'][level];
  }

  /* Two-decimal display that never rounds up onto a threshold the exact ratio misses. */
  function display(exactRatio) {
    var shown = round2(exactRatio);
    var limits = [3, 4.5, 7];
    for (var i = 0; i < limits.length; i++) {
      if (exactRatio < limits[i] && shown >= limits[i]) shown = round2(limits[i] - 0.01);
    }
    return shown;
  }

  /* Text color on background color: exact ratio, display value and the four verdicts. */
  function evaluate(fg, bg) {
    var r = ratio(fg, bg);
    return {
      ratio: r,
      rounded: display(r),
      AA: meets(r, 'AA', false),
      AAA: meets(r, 'AAA', false),
      AALarge: meets(r, 'AA', true),
      AAALarge: meets(r, 'AAA', true)
    };
  }

  return {
    THRESHOLDS: THRESHOLDS,
    parseHex: parseHex,
    luminance: luminance,
    ratio: ratio,
    round2: round2,
    display: display,
    meets: meets,
    evaluate: evaluate
  };
});
