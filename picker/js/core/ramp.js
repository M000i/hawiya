/*
 * 11-step color ramp from one color (task 1.4, R-041/R-081). Browser: window.Hawiya.ramp (load color.js first).
 *
 *   generate('#3b82f6') → { steps: [11 × '#rrggbb', lightest → darkest], anchor: <index of the input> }
 *
 * - Lightness runs evenly from LIGHTEST to DARKEST. The input is placed, unchanged, at the step nearest its own
 *   lightness on that even scale (plan.md §13); the steps on each side are then spread evenly up to LIGHTEST and
 *   down to DARKEST, so the lightness always decreases, with steps between 0.5× and 1.5× the even step.
 * - Hue stays the input's hue. Chroma follows a fixed profile (low in the very light and very dark steps), scaled
 *   so the anchor step keeps the input's chroma, then reduced only where the screen cannot show it.
 *   The scaling is capped at MAX_GAIN× the input's chroma: a pale tint (e.g. #f0f9ff) still gives a clearly
 *   colored ramp, while a near-white whose hue is mostly noise (#fffdf8, #feffff) stays muted.
 * - Grays (and white/black) give a gray ramp. Same input → same output (no randomness, no dates).
 */
(function (root, factory) {
  var color = typeof module === 'object' && module.exports ? require('./color.js') : root.Hawiya && root.Hawiya.color;
  if (!color) throw new Error('Hawiya.ramp: load color.js before ramp.js');
  var api = factory(color);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya.ramp = api;
  }
})(typeof self !== 'undefined' ? self : this, function (color) {
  'use strict';

  var STEPS = 11;
  var LIGHTEST = 0.975;
  var DARKEST = 0.16;
  /* Relative chroma per step (shape of hand-tuned palettes: muted tints, strongest around steps 6–7). */
  var CHROMA_PROFILE = [0.06, 0.13, 0.24, 0.4, 0.67, 0.87, 1.0, 0.99, 0.81, 0.66, 0.37];
  /* Largest factor by which a step's chroma may exceed the input's (the profile alone allows up to ~16.7×). */
  var MAX_GAIN = 8;

  function stepChroma(inputC, i, k) {
    return inputC * Math.min(CHROMA_PROFILE[i] / CHROMA_PROFILE[k], MAX_GAIN);
  }

  function anchorIndex(L) {
    var x = ((LIGHTEST - L) / (LIGHTEST - DARKEST)) * (STEPS - 1);
    var k = Math.round(x);
    // `k <= 0` (not `< 0`) also turns Math.round's -0 into a plain 0.
    return k <= 0 ? 0 : k > STEPS - 1 ? STEPS - 1 : k;
  }

  function lightnessAt(i, k, L) {
    if (i === k) return L;
    if (i < k) return LIGHTEST + ((L - LIGHTEST) * i) / k;
    return L + ((DARKEST - L) * (i - k)) / (STEPS - 1 - k);
  }

  function generate(hex) {
    var input = color.normalizeHex(hex);
    var o = color.toOklch(input);
    var k = anchorIndex(o.L);
    var gray = color.isAchromatic(o);
    var steps = [];
    for (var i = 0; i < STEPS; i++) {
      if (i === k) {
        steps.push(input);
        continue;
      }
      var C = gray ? 0 : stepChroma(o.C, i, k);
      steps.push(color.toHex({ L: lightnessAt(i, k, o.L), C: C, H: o.H }));
    }
    return { steps: steps, anchor: k };
  }

  return {
    STEPS: STEPS,
    LIGHTEST: LIGHTEST,
    DARKEST: DARKEST,
    CHROMA_PROFILE: CHROMA_PROFILE,
    MAX_GAIN: MAX_GAIN,
    generate: generate
  };
});
