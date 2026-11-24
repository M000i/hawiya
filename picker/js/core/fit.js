/*
 * Fit: orders the ready identities from the best fit for the project down, with the reasons.
 * Browser: window.Hawiya.fit (load color.js first). Node: require. Same input, same order: no randomness.
 *
 *   rank(identities, session, primaryOf) → [{ id, score, reasons: [{ kind, values }] }]
 *     identities: the published ready identities (picker/data/identities.js), in library order.
 *     session:    what the agent detected about the project (design/hawiya-session.json), or null.
 *     primaryOf(identity) → the identity's primary color as #rrggbb, or null.
 *   Points:
 *     sector   each sector of the project the identity lists: 4 for the first, 3 for the second; 1 more when the
 *              project's first sector is also the identity's first (its main field)
 *     tags     2 for each feel tag both share
 *     type     1 when the identity lists the project type
 *     brand    2 when the first brand color is within 25 degrees of hue of the identity's primary, 1 within 50
 *              (grays and near-grays, OKLCH chroma under 0.03, have no hue that counts and are left out)
 *   Highest score first; equal scores keep the library order. With no session every score is 0 and the order is
 *   the library's. reasons are in the order they weigh, only the kinds that scored: sector (values: the shared
 *   sectors), tags (the shared tags), type (the type), brand (no values).
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var color = node ? require('./color.js') : root.Hawiya && root.Hawiya.color;
  if (!color) throw new Error('Hawiya.fit: load color.js first');
  var api = factory(color);
  if (node) module.exports = api;
  else root.Hawiya.fit = api;
})(typeof self !== 'undefined' ? self : this, function (color) {
  'use strict';

  var SECTOR_POINTS = [4, 3];
  var TAG_POINTS = 2;
  var TYPE_POINTS = 1;
  var NEAR = 25;
  var CLOSE = 50;
  var MUTED = 0.03; // OKLCH chroma below this reads as gray (slate, stone...): its hue says nothing

  function list(x) {
    return Array.isArray(x) ? x : [];
  }

  // Hue distance in degrees (0..180), or null when either color is gray or not a color.
  function hueGap(a, b) {
    try {
      var x = color.toOklch(a);
      var y = color.toOklch(b);
      if (x.C < MUTED || y.C < MUTED) return null;
      var d = Math.abs(x.H - y.H) % 360;
      return d > 180 ? 360 - d : d;
    } catch (e) {
      return null;
    }
  }

  function scoreOne(identity, session, primaryOf) {
    var score = 0;
    var reasons = [];
    if (!session) return { id: identity.id, score: 0, reasons: reasons };

    var own = list(identity.sectors);
    var sectors = [];
    list(session.sectors).forEach(function (s, i) {
      if (i < SECTOR_POINTS.length && own.indexOf(s) !== -1) {
        score += SECTOR_POINTS[i];
        sectors.push(s);
      }
    });
    if (sectors.length) {
      if (own[0] === list(session.sectors)[0]) score += 1;
      reasons.push({ kind: 'sector', values: sectors });
    }

    var tags = list(session.tags).filter(function (t) {
      return list(identity.tags).indexOf(t) !== -1;
    });
    if (tags.length) {
      score += TAG_POINTS * tags.length;
      reasons.push({ kind: 'tags', values: tags });
    }

    if (session.type && list(identity.types).indexOf(session.type) !== -1) {
      score += TYPE_POINTS;
      reasons.push({ kind: 'type', values: [session.type] });
    }

    var brand = list(session.brandColors)[0];
    var primary = brand && primaryOf ? primaryOf(identity) : null;
    var gap = primary ? hueGap(brand, primary) : null;
    if (gap !== null && gap <= CLOSE) {
      score += gap <= NEAR ? 2 : 1;
      reasons.push({ kind: 'brand', values: [] });
    }

    // Order the reasons by what they weigh: sector, then tags, then brand, then type.
    var weight = { sector: 3, tags: 2, brand: 1, type: 0 };
    reasons.sort(function (a, b) {
      return weight[b.kind] - weight[a.kind];
    });
    return { id: identity.id, score: score, reasons: reasons };
  }

  function rank(identities, session, primaryOf) {
    return list(identities)
      .map(function (identity, i) {
        var r = scoreOne(identity, session || null, primaryOf);
        r.at = i;
        return r;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.at - b.at;
      })
      .map(function (r) {
        return { id: r.id, score: r.score, reasons: r.reasons };
      });
  }

  return { rank: rank, hueGap: hueGap };
});
