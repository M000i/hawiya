/*
 * Matching: how well a template suits the current choices (task 2.17, R-025/R-033). Browser: window.Hawiya.match.
 * Node: require. No dependencies.
 *
 *   profile(element, selections, find [, session]) → { tags: { <tag>: weight }, session: [tag], metrics:
 *     { roundness, density, intensity } (each a number or null) }
 *     What the other choices say about the identity: the tags of the templates chosen for every OTHER element
 *     (settings such as mode and direction excluded; weight = how many of them carry the tag) and the mean of
 *     their three values; plus the session's tags (what the user asked for, R-033). The element being scored is
 *     left out, so its own current choice does not vote for itself. A value of 0 means "not applicable" in the
 *     library (direction, modes, spacing roundness...) and is not averaged. find(element, id) returns a template;
 *     templates it cannot find are skipped.
 *   score(template, profile) → 0..1
 *     tags:    choices part = sum of the profile weights of the template's tags / (number of its tags × the
 *              largest weight); with a session, the mean of that and the session part (share of the template's
 *              tags the session names), so the user's own words weigh as much as all current choices together
 *     values:  1 − mean |template value − profile value| over the values both have
 *     score = 0.6 × tags + 0.4 × values (tags only when no value can be compared), rounded to 6 decimals
 *   rank(templates, profile) → [{ id, score }]   highest first; equal scores in id order, so the same input
 *                                                 always gives the same order
 *   best(element, templates, selections, find [, session, allowed]) → id or null
 *     the first of rank() with a score above 0 that allowed(template) accepts (all, when not given): the one
 *     marked «suits your choices». null for settings (mode, direction): they are not a style.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Hawiya = root.Hawiya || {}).match = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var METRICS = ['roundness', 'density', 'intensity'];
  var TAGS_SHARE = 0.6;

  function applicable(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }

  function profile(element, selections, find, session) {
    var tags = {};
    var sums = {};
    var counts = {};
    Object.keys(selections || {})
      .sort()
      .forEach(function (e) {
        if (e === element) return;
        var s = selections[e];
        var tpl = s && find ? find(e, s.template) : null;
        if (!tpl || tpl.kind === 'setting') return; // settings (mode, direction) say nothing about style
        (tpl.tags || []).forEach(function (tag) {
          tags[tag] = (tags[tag] || 0) + 1;
        });
        METRICS.forEach(function (m) {
          var v = tpl.metrics && tpl.metrics[m];
          if (applicable(v)) {
            sums[m] = (sums[m] || 0) + v;
            counts[m] = (counts[m] || 0) + 1;
          }
        });
      });
    var asked = [];
    (session && Array.isArray(session.tags) ? session.tags : []).forEach(function (tag) {
      if (typeof tag === 'string' && asked.indexOf(tag) === -1) asked.push(tag);
    });
    asked.sort();
    var metrics = {};
    METRICS.forEach(function (m) {
      metrics[m] = counts[m] ? sums[m] / counts[m] : null;
    });
    return { tags: tags, session: asked, metrics: metrics };
  }

  function isSetting(t) {
    return t && t.kind === 'setting';
  }

  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  function score(tpl, prof) {
    var own = tpl.tags || [];
    var weights = Object.keys(prof.tags).map(function (k) {
      return prof.tags[k];
    });
    var top = weights.length ? Math.max.apply(null, weights) : 0;
    var tagScore = 0;
    if (own.length && top > 0) {
      var sum = 0;
      own.forEach(function (tag) {
        sum += Object.prototype.hasOwnProperty.call(prof.tags, tag) ? prof.tags[tag] : 0;
      });
      tagScore = sum / (own.length * top);
    }
    var asked = prof.session || [];
    if (asked.length && own.length) {
      var named = own.filter(function (tag) {
        return asked.indexOf(tag) !== -1;
      }).length;
      tagScore = (tagScore + named / own.length) / 2;
    }
    var diffs = [];
    METRICS.forEach(function (m) {
      var v = tpl.metrics && tpl.metrics[m];
      if (applicable(v) && prof.metrics[m] !== null) diffs.push(Math.abs(v - prof.metrics[m]));
    });
    if (!diffs.length) return round6(tagScore);
    var mean =
      diffs.reduce(function (a, b) {
        return a + b;
      }, 0) / diffs.length;
    return round6(TAGS_SHARE * tagScore + (1 - TAGS_SHARE) * (1 - mean));
  }

  function rank(templates, prof) {
    return (templates || [])
      .map(function (t) {
        return { id: t.id, score: score(t, prof) };
      })
      .sort(function (a, b) {
        return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
  }

  function best(element, templates, selections, find, session, allowed) {
    // Settings (mode, direction) are the project's decisions, not a style to suggest.
    if ((templates || []).some(isSetting)) return null;
    var byId = {};
    (templates || []).forEach(function (t) {
      byId[t.id] = t;
    });
    var list = rank(templates, profile(element, selections, find, session));
    for (var i = 0; i < list.length; i++) {
      if (list[i].score <= 0) return null;
      if (!allowed || allowed(byId[list[i].id])) return list[i].id;
    }
    return null;
  }

  return { METRICS: METRICS, profile: profile, score: score, rank: rank, best: best };
});
