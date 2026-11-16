/*
 * «Fill the rest for me» (task 2.18, R-024 / AC-16). Browser: window.Hawiya.autofill (load rules.js, match.js and
 * resolve.js first). Node: require. Nothing is read from the page: the same input always gives the same output.
 *
 *   fill(choices, chosen, data [, session]) → { choices, filled: [element], allowed, problems }
 *     choices  the current choices (resolve.resolve's input); not changed
 *     chosen   the elements the user chose; every other element is filled
 *     data     { templates: { <element>: [template, ...] } }, every element's full list
 *     session  optional { tags: [tag] }: what the user asked for (R-033)
 *
 *   Elements are filled one by one, in the fixed element order:
 *   - A setting (mode, direction) keeps its current value: it is a decision about the project, not a style.
 *   - Any other element gets the first template of match.rank, scored against the chosen elements and those
 *     already filled (never against the values about to be replaced), with which the whole identity still passes
 *     every blocking rule (rules.identity). A palette that misses the contrast level is used with the nearest
 *     passing colors the rules suggest (at AAA every published palette needs them, B-041). If no template passes,
 *     the current one stays.
 *   The filled elements are listed in autoFilled (the generated files say so), and a filled element is the plain
 *   template, without the adjustments of the value it replaced.
 *   Each step is accepted only if the identity still passes, so when the current choices pass, the result passes.
 *   allowed / problems are the blocking rules' verdict on the result; when the current choices already break a
 *   rule, allowed is false and the page must not apply the result.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var H = node ? null : root.Hawiya || {};
  var rules = node ? require('./rules.js') : H.rules;
  var match = node ? require('./match.js') : H.match;
  var resolve = node ? require('./resolve.js') : H.resolve;
  if (!rules || !match || !resolve) throw new Error('Hawiya.autofill: load rules.js, match.js and resolve.js first');
  var api = factory(rules, match, resolve);
  if (node) module.exports = api;
  else root.Hawiya.autofill = api;
})(typeof self !== 'undefined' ? self : this, function (rules, match, resolve) {
  'use strict';

  var ELEMENTS = resolve.ELEMENTS;

  function copy(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function finder(data) {
    return function (element, id) {
      var list = data.templates[element] || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    };
  }

  // The verdict of the blocking rules on these choices; a choice the library cannot build is not allowed.
  function check(choices, data, find) {
    var identity;
    try {
      identity = resolve.resolve(choices, data);
    } catch (e) {
      return { allowed: false, problems: [{ rule: 'build', element: null }], suggestion: null };
    }
    return rules.identity(identity, find);
  }

  function isSetting(list) {
    return list.some(function (t) {
      return t && t.kind === 'setting';
    });
  }

  function fill(choices, chosen, data, session) {
    if (!Array.isArray(chosen)) throw new Error('Hawiya.autofill: chosen must be a list of elements');
    chosen.forEach(function (e) {
      if (ELEMENTS.indexOf(e) === -1) throw new Error('Hawiya.autofill: unknown element "' + e + '"');
    });
    ELEMENTS.forEach(function (e) {
      if (!data || !data.templates || !Array.isArray(data.templates[e]) || !data.templates[e].length) {
        throw new Error('Hawiya.autofill: no templates for "' + e + '"');
      }
    });
    var find = finder(data);
    var next = copy(choices);
    var missing = ELEMENTS.filter(function (e) {
      return chosen.indexOf(e) === -1;
    });
    // What the scoring may look at: the chosen elements, then each one as it is filled.
    var known = {};
    ELEMENTS.forEach(function (e) {
      if (chosen.indexOf(e) !== -1) known[e] = next.selections[e];
    });

    missing.forEach(function (element) {
      var list = data.templates[element];
      if (isSetting(list)) {
        known[element] = next.selections[element];
        return;
      }
      var ranked = match.rank(list, match.profile(element, known, find, session || null));
      for (var i = 0; i < ranked.length; i++) {
        var trial = copy(next);
        trial.selections[element] = { template: ranked[i].id };
        var r = check(trial, data, find);
        if (!r.allowed && element === 'colors' && r.suggestion) {
          trial.selections.colors.overrides = copy(r.suggestion.overrides);
          r = check(trial, data, find);
        }
        if (r.allowed) {
          next = trial;
          break;
        }
      }
      known[element] = next.selections[element]; // the template accepted, or the current one when none passed
    });

    next.autoFilled = missing.slice();
    var verdict = check(next, data, find);
    return { choices: next, filled: missing, allowed: verdict.allowed, problems: verdict.problems };
  }

  return { fill: fill };
});
