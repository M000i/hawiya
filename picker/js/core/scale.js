/*
 * Modular type scale (task 1.6, R-082/R-044). Browser: window.Hawiya.scale; Node: require.
 *
 *   generate({ base: 16, ratio: 1.25, steps: 5 })            → [16, 20, 25, 31.25, 39.06]
 *   generate({ base: 16, ratio: 1.25, steps: 6, below: 1 })  → [12.8, 16, 20, 25, 31.25, 39.06]
 *
 * - `steps` sizes in total, smallest first; `below` of them are smaller than the base (captions, labels).
 * - Sizes are computed outward FROM THE BASE: upward by repeated multiplication, downward by repeated division
 *   (IEEE-exact basic operations, identical in every JavaScript engine; Math.pow is not). So the sizes above the
 *   base never depend on how many small sizes are requested.
 * - Sizes are rounded to two decimals, half-up in decimal terms (26.675 → 26.68), as a person would (spec.md §12).
 * - Limits match identity.schema.json: base 10..32, ratio above 1 up to 2, 3..12 steps, every size 6..200 px.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.scale = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = { baseMin: 10, baseMax: 32, ratioMax: 2, stepsMin: 3, stepsMax: 12, sizeMin: 6, sizeMax: 200 };

  function fail(msg) {
    throw new Error('Hawiya.scale: ' + msg);
  }

  /* Decimal half-up: x*100 is first trimmed to 12 significant digits so binary noise (2667.4999999999995)
     cannot turn a decimal tie into a round-down. toPrecision and Math.round are exactly specified, so this is
     identical in every engine. */
  function round2(x) {
    return Math.round(Number((x * 100).toPrecision(12))) / 100;
  }

  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function generate(opts) {
    if (!opts || typeof opts !== 'object') fail('expected { base, ratio, steps[, below] }');
    var base = opts.base;
    var ratio = opts.ratio;
    var steps = opts.steps;
    var below = opts.below === undefined ? 0 : opts.below;
    if (!isNum(base) || base < LIMITS.baseMin || base > LIMITS.baseMax) fail('base must be a number from 10 to 32');
    if (!isNum(ratio) || !(ratio > 1) || ratio > LIMITS.ratioMax) fail('ratio must be a number above 1 and at most 2');
    if (!Number.isInteger(steps) || steps < LIMITS.stepsMin || steps > LIMITS.stepsMax) fail('steps must be an integer from 3 to 12');
    if (!Number.isInteger(below) || below < 0 || below >= steps) fail('below must be an integer from 0 to steps - 1');

    var exact = new Array(steps);
    var x = base;
    exact[below] = base;
    for (var up = below + 1; up < steps; up++) {
      x = x * ratio;
      exact[up] = x;
    }
    x = base;
    for (var down = below - 1; down >= 0; down--) {
      x = x / ratio;
      exact[down] = x;
    }

    var sizes = exact.map(round2);
    sizes.forEach(function (s) {
      if (s < LIMITS.sizeMin || s > LIMITS.sizeMax) fail('size ' + s + ' px is outside 6..200; use fewer steps or a smaller ratio');
    });
    for (var j = 1; j < sizes.length; j++) {
      if (!(sizes[j] > sizes[j - 1])) fail('ratio too close to 1: sizes ' + sizes[j - 1] + ' and ' + sizes[j] + ' are equal after rounding');
    }
    return sizes;
  }

  return { LIMITS: LIMITS, round2: round2, generate: generate };
});
