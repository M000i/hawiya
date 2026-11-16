/*
 * Light and dark color sets from one primary color (task 1.5, R-042/R-081).
 * Browser: window.Hawiya.modes (load color.js, contrast.js, ramp.js first).
 *
 *   derive('#3b82f6' [, { secondary: '#rrggbb' }]) →
 *     { light: colorSet, dark: colorSet, ramps: { primary, secondary, neutral } }   (shape of identity.schema.json)
 *
 * colorSet keys: primary, onPrimary, secondary, onSecondary, accentText, background, surface, onSurface,
 * mutedText, border, success, warning, danger, info.
 *
 *   options: { secondary?: '#rrggbb', level?: 'AA' | 'AAA' }   (level defaults to AA)
 *
 * Readability guarantees (WCAG AA, 4.5:1; with level AAA, 7:1), in BOTH modes:
 * - onSurface, mutedText, accentText and the four status colors reach 4.5:1 on background AND on surface,
 *   so each can be used as text anywhere. They are picked from their own ramps (nearest step that passes);
 *   if no step passes, onSurface is used.
 * - onPrimary / onSecondary are black or white, whichever is stronger (always ≥ 4.58:1).
 * - With level AAA: the text roles above reach 7:1 instead; the derived secondary (none given) is the nearest
 *   step of its ramp whose black or white text reaches 7:1; the dark-mode fills also keep 7:1 for their text.
 *   The chosen primary and a given secondary are kept as they are: if their own text misses 7:1 the rules
 *   engine (rules.js) blocks them and suggests the nearest step that passes. Level AA output is unchanged.
 * - In dark mode the primary and secondary fills reach 3:1 against the dark background and surface (WCAG 1.4.11).
 *   (In light mode the input is kept as the primary as chosen; its visibility on white is a rules-engine
 *   warning, backlog B-001.)
 * Neutrals and the automatic secondary are tinted with the primary's hue, in proportion to the primary's
 * chroma (full tint from chroma FULL_TINT_AT): a gray or near-gray primary gives gray neutrals and secondary,
 * because its hue is only rounding noise (see color.isAchromatic). Dark surfaces use neutral steps 9 and 10 of the tinted
 * neutral ramp, which stay distinguishable (backlog B-009 concerns ramps of a black input, not used here).
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var H = node ? null : root.Hawiya || {};
  var color = node ? require('./color.js') : H.color;
  var contrast = node ? require('./contrast.js') : H.contrast;
  var ramp = node ? require('./ramp.js') : H.ramp;
  if (!color || !contrast || !ramp) throw new Error('Hawiya.modes: load color.js, contrast.js and ramp.js first');
  var api = factory(color, contrast, ramp);
  if (node) module.exports = api;
  else root.Hawiya.modes = api;
})(typeof self !== 'undefined' ? self : this, function (color, contrast, ramp) {
  'use strict';

  var AA = 4.5;
  var AAA = 7;
  var WHITE = '#ffffff';
  var BLACK = '#000000';
  /* Status seeds (green, amber, red, blue); each becomes a ramp, then the readable step is picked per mode. */
  var STATUS = { success: '#16a34a', warning: '#d97706', danger: '#dc2626', info: '#2563eb' };
  var NEUTRAL_L = 0.55;
  var NEUTRAL_TINT = 0.012;
  var SECONDARY_L = 0.5;
  var SECONDARY_C = 0.05;
  /* Primary chroma at which neutrals and the auto secondary get their full tint; below it the tint shrinks
     in proportion, so a near-gray primary (hue = rounding noise) gives near-gray neutrals and secondary. */
  var FULL_TINT_AT = 0.08;
  /* Filled buttons in dark mode must stand out from the dark background and surface (WCAG 1.4.11: 3:1). */
  var UI = 3;

  function onColor(hex) {
    return contrast.ratio(WHITE, hex) >= contrast.ratio(BLACK, hex) ? WHITE : BLACK;
  }

  function readableOn(hex, backgrounds, min) {
    for (var i = 0; i < backgrounds.length; i++) {
      if (contrast.ratio(hex, backgrounds[i]) < (min || AA)) return false;
    }
    return true;
  }

  /* Dark-mode fill: start one step lighter than the input's step (kept within 2..5), then go lighter until
     it reaches 3:1 on the dark background and surface. */
  function darkFill(r, backgrounds, min) {
    var i = clamp(r.anchor - 1, 2, 5);
    while (i > 0 && !(readableOn(r.steps[i], backgrounds, UI) && textOn(r.steps[i], min))) i--;
    return r.steps[i];
  }

  /* At AA black or white always reaches 4.5:1 on any fill; at AAA the fill's own text is checked too. */
  function textOn(fill, min) {
    return min <= AA || contrast.ratio(onColor(fill), fill) >= min;
  }

  /* Nearest step of a ramp to its input (ties: the darker one) whose black or white text reaches `min`. */
  function nearestFill(r, min) {
    for (var d = 0; d < r.steps.length; d++) {
      var down = r.anchor + d;
      var up = r.anchor - d;
      if (down < r.steps.length && textOn(r.steps[down], min)) return r.steps[down];
      if (up >= 0 && textOn(r.steps[up], min)) return r.steps[up];
    }
    return r.steps[r.anchor];
  }

  /* First step from `start`, moving by `dir` (+1 darker, -1 lighter), that is readable on every background. */
  function pickText(steps, start, dir, backgrounds, fallback, min) {
    for (var i = start; i >= 0 && i < steps.length; i += dir) {
      if (readableOn(steps[i], backgrounds, min)) return steps[i];
    }
    return fallback;
  }

  function clamp(i, lo, hi) {
    return i < lo ? lo : i > hi ? hi : i;
  }

  function derive(primaryHex, options) {
    var opts = options || {};
    if (opts.level !== undefined && opts.level !== 'AA' && opts.level !== 'AAA') {
      throw new Error('Hawiya.modes: level must be "AA" or "AAA"');
    }
    var min = opts.level === 'AAA' ? AAA : AA;
    var primary = color.normalizeHex(primaryHex);
    var po = color.toOklch(primary);
    var gray = color.isAchromatic(po);
    var tint = gray ? 0 : Math.min(1, po.C / FULL_TINT_AT);

    var neutralSeed = color.toHex({ L: NEUTRAL_L, C: NEUTRAL_TINT * tint, H: po.H });
    var secondaryHex = opts.secondary != null
      ? color.normalizeHex(opts.secondary)
      : color.toHex({ L: SECONDARY_L, C: SECONDARY_C * tint, H: po.H });

    var P = ramp.generate(primary);
    var S = ramp.generate(secondaryHex);
    if (opts.secondary == null && min > AA) secondaryHex = nearestFill(S, min);
    var N = ramp.generate(neutralSeed).steps;
    var status = {};
    Object.keys(STATUS).forEach(function (k) {
      status[k] = ramp.generate(STATUS[k]).steps;
    });

    /* ---------- light ---------- */
    var lBg = WHITE;
    var lSurface = N[0];
    var lBgs = [lBg, lSurface];
    var lText = pickText(N, 10, -1, lBgs, BLACK, min);
    var light = {
      primary: primary,
      onPrimary: onColor(primary),
      secondary: secondaryHex,
      onSecondary: onColor(secondaryHex),
      accentText: readableOn(primary, lBgs, min) ? primary : pickText(P.steps, P.anchor + 1, 1, lBgs, lText, min),
      background: lBg,
      surface: lSurface,
      onSurface: lText,
      mutedText: pickText(N, 6, 1, lBgs, lText, min),
      border: N[2]
    };

    /* ---------- dark ---------- */
    var dBg = N[10];
    var dSurface = N[9];
    var dBgs = [dBg, dSurface];
    var dText = pickText(N, 0, 1, dBgs, WHITE, min);
    var dPrimary = darkFill(P, dBgs, min);
    var dSecondary = darkFill(S, dBgs, min);
    var dPrimaryIdx = P.steps.indexOf(dPrimary);
    var dark = {
      primary: dPrimary,
      onPrimary: onColor(dPrimary),
      secondary: dSecondary,
      onSecondary: onColor(dSecondary),
      accentText: pickText(P.steps, dPrimaryIdx, -1, dBgs, dText, min),
      background: dBg,
      surface: dSurface,
      onSurface: dText,
      mutedText: pickText(N, 4, -1, dBgs, dText, min),
      border: N[8]
    };

    Object.keys(STATUS).forEach(function (k) {
      light[k] = pickText(status[k], 5, 1, lBgs, lText, min);
      dark[k] = pickText(status[k], 5, -1, dBgs, dText, min);
    });

    return {
      light: order(light),
      dark: order(dark),
      ramps: { primary: P.steps, secondary: S.steps, neutral: N }
    };
  }

  /* Fixed key order (identity.schema.json colorSet) so the generated files are byte-stable. */
  var KEYS = ['primary', 'onPrimary', 'secondary', 'onSecondary', 'accentText', 'background', 'surface', 'onSurface',
    'mutedText', 'border', 'success', 'warning', 'danger', 'info'];
  function order(set) {
    var out = {};
    KEYS.forEach(function (k) {
      out[k] = set[k];
    });
    return out;
  }

  return { AA: AA, AAA: AAA, UI: UI, KEYS: KEYS, STATUS: STATUS, FULL_TINT_AT: FULL_TINT_AT, derive: derive };
});
