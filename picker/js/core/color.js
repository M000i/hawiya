/*
 * sRGB <-> OKLCH (task 1.3, R-081). Works in the browser (window.Hawiya.color) and in Node.
 *
 * OKLab by Björn Ottosson (https://bottosson.github.io/posts/oklab/), constants as published there.
 * OKLCH is OKLab in polar form: L (lightness 0..1), C (chroma >= 0), H (hue in degrees 0..360).
 *
 * Out-of-gamut colors (OKLCH values the sRGB screen cannot show) are brought into gamut by REDUCING
 * CHROMA only, keeping lightness and hue (binary search), then rounded to the nearest 8-bit color.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.color = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * Below this chroma a color is treated as gray: C = 0 and H = 0. H = 0 then means "no hue", NOT red:
   * use isAchromatic() before borrowing a hue from a color (e.g. tinting neutrals with the primary's hue).
   */
  var ACHROMATIC = 1e-4;
  /*
   * Tolerance for "inside the sRGB gamut" on linear channels. The published 10-digit OKLab constants are not
   * exact inverses: a round trip overshoots by up to ~1.3e-7 (worst case #ffff00), so 1e-6 is needed for every
   * real sRGB color to count as in gamut. That is < 0.004 of one 8-bit step, so no visible color is wrongly let in.
   */
  var GAMUT_EPS = 1e-6;
  /* No sRGB color has chroma above ~0.33; anything larger is searched from this cap. */
  var MAX_SRGB_CHROMA = 0.5;

  function fail(msg) {
    throw new Error('Hawiya.color: ' + msg);
  }

  /* ---------- sRGB ---------- */

  function parseHex(hex) {
    if (typeof hex !== 'string') fail('color must be a string');
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
    if (!m) fail('not a #rgb or #rrggbb color: ' + JSON.stringify(hex));
    var h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function decode(c8) {
    var c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function encode(lin) {
    var c = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    var v = Math.round(c * 255);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /* Canonical form used everywhere in Hawiya: lowercase #rrggbb (#ABC → #aabbcc). */
  function normalizeHex(hex) {
    return toHexString(parseHex(hex));
  }

  function toHexString(rgb8) {
    return '#' + rgb8.map(function (v) {
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  /* ---------- OKLab ---------- */

  function linearToOklab(r, g, b) {
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }

  function oklabToLinear(L, a, b) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b;
    var m = L - 0.1055613458 * a - 0.0638541728 * b;
    var s = L - 0.0894841775 * a - 1.291485548 * b;
    l = l * l * l;
    m = m * m * m;
    s = s * s * s;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
  }

  /* ---------- OKLCH ---------- */

  /* #rrggbb (or #rgb) → { L, C, H }. Grays get C = 0 and H = 0. */
  function toOklch(hex) {
    var rgb = parseHex(hex);
    var lab = linearToOklab(decode(rgb[0]), decode(rgb[1]), decode(rgb[2]));
    var C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    var H = 0;
    if (C < ACHROMATIC) {
      C = 0;
    } else {
      H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
      if (H < 0) H += 360;
    }
    return { L: lab.L, C: C, H: H };
  }

  function checkLch(o) {
    if (!o || typeof o !== 'object') fail('expected an object { L, C, H }');
    ['L', 'C', 'H'].forEach(function (k) {
      if (typeof o[k] !== 'number' || !isFinite(o[k])) fail(k + ' must be a finite number');
    });
  }

  function lchToLinear(L, C, H) {
    var rad = (H * Math.PI) / 180;
    return oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad));
  }

  function linearInGamut(lin) {
    for (var i = 0; i < 3; i++) {
      // Written so that NaN (e.g. from Infinity - Infinity) counts as OUT of gamut.
      if (!(lin[i] >= -GAMUT_EPS && lin[i] <= 1 + GAMUT_EPS)) return false;
    }
    return true;
  }

  /* True for grays (C = 0): their H is a placeholder, not a hue to reuse. */
  function isAchromatic(o) {
    checkLch(o);
    return o.C < ACHROMATIC;
  }

  /* Whether the screen (sRGB) can show this OKLCH color as given. */
  function inGamut(o) {
    checkLch(o);
    if (o.L < 0 || o.L > 1 || o.C < 0) return false;
    return linearInGamut(lchToLinear(o.L, o.C, o.H));
  }

  /*
   * Same lightness and hue, chroma reduced (only if needed) to the largest value the screen can show.
   * Lightness outside 0..1 is clamped first; negative chroma counts as 0.
   */
  function clampChroma(o) {
    checkLch(o);
    var L = Math.min(1, Math.max(0, o.L));
    // Wrap only when needed: the modulo arithmetic would otherwise nudge an in-range hue (29.2 → 29.19999…).
    var H = o.H >= 0 && o.H < 360 ? o.H : ((o.H % 360) + 360) % 360;
    var C = Math.max(0, o.C);
    if (L === 0 || L === 1) return { L: L, C: 0, H: H };
    if (linearInGamut(lchToLinear(L, C, H))) return { L: L, C: C, H: H };
    var lo = 0;
    var hi = Math.min(C, MAX_SRGB_CHROMA);
    if (linearInGamut(lchToLinear(L, hi, H))) return { L: L, C: hi, H: H };
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (linearInGamut(lchToLinear(L, mid, H))) lo = mid;
      else hi = mid;
    }
    return { L: L, C: lo, H: H };
  }

  /* { L, C, H } → #rrggbb, reducing chroma first if the color is outside the sRGB gamut. */
  function toHex(o) {
    var g = clampChroma(o);
    if (g.L === 0) return '#000000';
    if (g.L === 1) return '#ffffff';
    var lin = lchToLinear(g.L, g.C, g.H);
    return toHexString([encode(lin[0]), encode(lin[1]), encode(lin[2])]);
  }

  return {
    ACHROMATIC: ACHROMATIC,
    parseHex: parseHex,
    normalizeHex: normalizeHex,
    toOklch: toOklch,
    isAchromatic: isAchromatic,
    inGamut: inGamut,
    clampChroma: clampChroma,
    toHex: toHex
  };
});
