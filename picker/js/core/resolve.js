/*
 * From choices to a complete identity (task 2.4, R-070/R-091).
 * Browser: window.Hawiya.resolve (load color.js, contrast.js, ramp.js, modes.js, scale.js, schemas.js and
 * validate.js first; the published library is read from window.Hawiya.data unless `data` is given).
 * Node: require.
 *
 *   resolve(choices [, data]) → identity (identity.schema.json), or throws ResolveError with .problems
 *
 *   choices = {
 *     name: string,                                    the identity's display name
 *     selections: { <element>: { template: id, overrides?: { key: value } } }   all 11 elements
 *     project?: { type?: 'web-app' | ..., contrast?: 'AA' | 'AAA' },            defaults web-app, AA
 *     motion?: 'none' | 'subtle' | 'medium' | 'strong',                        default subtle
 *     autoFilled?: [element], leaveToAI?: [id]
 *   }
 *   data = { templates: { <element>: [template, ...] } }   (picker/data, reviewed templates only)
 *
 * Adjustments allowed on top of a template (anything else is refused, never ignored):
 *   colors      primary, secondary              #rrggbb (any case; written lowercase)
 *   fonts       latin-size-adjust                0.5 .. 2
 *   type-scale  base 10..32, ratio >1..2, steps 3..12 (integer), below 0..steps-1 (integer),
 *               line-height-ar, line-height-en   1 .. 2.5
 *   radius      sm, md, lg                       integer 0 .. 64
 *   icons       fill (outline|filled|duotone), container (none|circle|square|rounded)
 *   spacing     unit                             integer 2 .. 8 (the template's scale is resized to it)
 *   direction   numerals (latn|arab), calendar (gregory|islamic-umalqura)
 *
 * The language and direction come from the direction template; colors are derived by modes.derive (both
 * modes, AA text); the type scale by scale.generate. The result is checked with the identity checker before it
 * is returned, so a returned identity always passes it. Same choices (in any key order) give the same identity.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var H = node ? null : root.Hawiya || {};
  var modes = node ? require('./modes.js') : H.modes;
  var scale = node ? require('./scale.js') : H.scale;
  var validate = node ? require('./validate.js') : H.validate;
  if (!modes || !scale || !validate) throw new Error('Hawiya.resolve: load modes.js, scale.js and validate.js first');
  var api = factory(modes, scale, validate, function () {
    return node ? null : root.Hawiya && root.Hawiya.data;
  });
  if (node) module.exports = api;
  else root.Hawiya.resolve = api;
})(typeof self !== 'undefined' ? self : this, function (modes, scale, validate, pageData) {
  'use strict';

  var ELEMENTS = [
    'colors',
    'modes',
    'fonts',
    'type-scale',
    'radius',
    'shadows',
    'icons',
    'buttons',
    'cards',
    'spacing',
    'direction'
  ];
  var GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace'];
  var PROJECT_TYPES = ['landing', 'website', 'web-app', 'dashboard', 'html-page'];
  var CONTRAST = ['AA', 'AAA'];
  var MOTION = ['none', 'subtle', 'medium', 'strong'];
  var LANGUAGE = { rtl: 'ar', ltr: 'en', both: 'ar+en' };
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function ResolveError(problems) {
    var e = new Error('cannot build the identity: ' + problems.join('; '));
    e.name = 'ResolveError';
    e.problems = problems;
    Object.setPrototypeOf(e, ResolveError.prototype);
    return e;
  }
  ResolveError.prototype = Object.create(Error.prototype);
  ResolveError.prototype.constructor = ResolveError;

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }
  function isInt(x) {
    return isNum(x) && Math.floor(x) === x;
  }

  /* ---------- allowed adjustments ---------- */

  function hexValue(v) {
    return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;
  }
  function range(lo, hi, integer, openLo) {
    return function (v) {
      if (!(integer ? isInt(v) : isNum(v))) return undefined;
      if (openLo ? !(v > lo) : v < lo) return undefined;
      if (v > hi) return undefined;
      return v === 0 ? 0 : v; // -0 becomes 0, as it would after a JSON round trip
    };
  }
  function oneOf(list) {
    return function (v) {
      return list.indexOf(v) === -1 ? undefined : v;
    };
  }

  var OVERRIDES = {
    colors: { primary: [hexValue, '#rrggbb'], secondary: [hexValue, '#rrggbb'] },
    fonts: { 'latin-size-adjust': [range(0.5, 2), 'a number from 0.5 to 2'] },
    'type-scale': {
      base: [range(10, 32), 'a number from 10 to 32'],
      ratio: [range(1, 2, false, true), 'a number above 1 and at most 2'],
      steps: [range(3, 12, true), 'an integer from 3 to 12'],
      below: [range(0, 11, true), 'an integer from 0 to 11'],
      'line-height-ar': [range(1, 2.5), 'a number from 1 to 2.5'],
      'line-height-en': [range(1, 2.5), 'a number from 1 to 2.5']
    },
    radius: {
      sm: [range(0, 64, true), 'an integer from 0 to 64'],
      md: [range(0, 64, true), 'an integer from 0 to 64'],
      lg: [range(0, 64, true), 'an integer from 0 to 64']
    },
    icons: {
      fill: [oneOf(['outline', 'filled', 'duotone']), 'outline, filled or duotone'],
      container: [oneOf(['none', 'circle', 'square', 'rounded']), 'none, circle, square or rounded']
    },
    spacing: { unit: [range(2, 8, true), 'an integer from 2 to 8'] },
    direction: {
      numerals: [oneOf(['latn', 'arab']), 'latn or arab'],
      calendar: [oneOf(['gregory', 'islamic-umalqura']), 'gregory or islamic-umalqura']
    }
  };

  /* ---------- reading template values (DTCG) ---------- */

  function px(tok, where, problems) {
    if (tok && tok.$type === 'dimension' && tok.$value && tok.$value.unit === 'px' && isNum(tok.$value.value))
      return tok.$value.value;
    problems.push(where + ': expected a px dimension');
    return 0;
  }
  function plain(tok, where, problems) {
    if (tok && hasOwn(tok, '$value') && tok.$value !== null && typeof tok.$value !== 'object') return tok.$value;
    problems.push(where + ': expected a value');
    return undefined;
  }
  function shadowLayers(tok, where, problems) {
    if (!tok || tok.$type !== 'shadow' || !Array.isArray(tok.$value)) {
      problems.push(where + ': expected a shadow');
      return [];
    }
    return tok.$value.map(function (l, i) {
      var at = where + '[' + i + ']';
      var c = l && l.color;
      if (!c || typeof c.hex !== 'string') problems.push(at + ': expected a color with hex');
      var layer = {
        x: px({ $type: 'dimension', $value: l && l.offsetX }, at + '.offsetX', problems),
        y: px({ $type: 'dimension', $value: l && l.offsetY }, at + '.offsetY', problems),
        blur: px({ $type: 'dimension', $value: l && l.blur }, at + '.blur', problems),
        spread: px({ $type: 'dimension', $value: l && l.spread }, at + '.spread', problems),
        color: c && typeof c.hex === 'string' ? c.hex.toLowerCase() : '#000000',
        alpha: c && hasOwn(c, 'alpha') ? c.alpha : 1
      };
      if (l && l.inset === true) layer.inset = true;
      return layer;
    });
  }

  // Half-up to an integer in decimal terms, like scale.js does for sizes.
  function roundInt(x) {
    return Math.floor(Number(x.toFixed(6)) + 0.5);
  }

  /* ---------- per element ---------- */

  function fontRoles(t, ov, problems) {
    var ex = t.extras || {};
    var fam = t.tokens && t.tokens.font && t.tokens.font.body && t.tokens.font.body.$value;
    if (typeof ex.arabic !== 'string' && typeof ex.latin !== 'string')
      problems.push('fonts: the template names no font family');
    var fallback = (Array.isArray(fam) ? fam : []).filter(function (f, i, all) {
      return GENERIC.indexOf(f) !== -1 && all.indexOf(f) === i;
    });
    if (fallback.length === 0) fallback = ['system-ui', 'sans-serif'];
    fallback = fallback.slice(0, 3);
    var adjust = hasOwn(ov, 'latin-size-adjust') ? ov['latin-size-adjust'] : ex.latinSizeAdjust;
    // A size adjustment only means something between two different families (R-090): refused, not ignored.
    var twoFamilies = typeof ex.arabic === 'string' && typeof ex.latin === 'string' && ex.arabic !== ex.latin;
    if (hasOwn(ov, 'latin-size-adjust') && !twoFamilies)
      problems.push('fonts: latin-size-adjust has no effect, the template uses one family for both scripts');

    function role(arabic) {
      var r = {};
      if (typeof arabic === 'string') r.arabic = arabic;
      if (typeof ex.latin === 'string') r.latin = ex.latin;
      r.fallback = fallback.slice();
      // A size adjustment only means something between two different families (R-090).
      if (r.arabic && r.latin && r.arabic !== r.latin && isNum(adjust)) r.latinSizeAdjust = adjust;
      return r;
    }
    var numerals = role(typeof ex.numeralsFont === 'string' ? ex.numeralsFont : ex.arabic);
    if (typeof ex.easternArabicDigits === 'boolean') numerals.easternArabicDigits = ex.easternArabicDigits;
    return { heading: role(ex.arabic), body: role(ex.arabic), numerals: numerals };
  }

  function typeScale(t, ov, problems) {
    var ts = (t.tokens && t.tokens.typeScale) || {};
    var base = hasOwn(ov, 'base') ? ov.base : px(ts.base, 'type-scale.base', problems);
    var ratio = hasOwn(ov, 'ratio') ? ov.ratio : plain(ts.ratio, 'type-scale.ratio', problems);
    var steps = hasOwn(ov, 'steps') ? ov.steps : plain(ts.steps, 'type-scale.steps', problems);
    var below = hasOwn(ov, 'below') ? ov.below : ts.below ? plain(ts.below, 'type-scale.below', problems) : 0;
    try {
      return {
        base: base,
        ratio: ratio,
        steps: scale.generate({ base: base, ratio: ratio, steps: steps, below: below })
      };
    } catch (e) {
      problems.push('type-scale: ' + e.message);
      return null;
    }
  }

  function spacing(t, ov, problems) {
    var sp = (t.tokens && t.tokens.spacing) || {};
    var unit = px(sp.unit, 'spacing.unit', problems);
    // Step names are numbers ("0", "0.5", "1", ...); JavaScript lists whole-number keys first, so sort them.
    var keys = (sp.scale ? Object.keys(sp.scale) : []).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    keys.forEach(function (k) {
      if (!isNum(Number(k)) || k.trim() === '') problems.push('spacing.scale: "' + k + '" is not a step number');
    });
    var list = keys.map(function (k) {
      return px(sp.scale[k], 'spacing.scale.' + k, problems);
    });
    if (hasOwn(ov, 'unit') && unit > 0) {
      var to = ov.unit;
      list = list.map(function (v) {
        return roundInt((v * to) / unit);
      });
      unit = to;
    }
    return { unit: unit, scale: list };
  }

  /* ---------- main ---------- */

  function find(templates, element, id, problems) {
    var list = (templates && templates[element]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    for (var e = 0; e < ELEMENTS.length; e++) {
      var other = (templates && templates[ELEMENTS[e]]) || [];
      for (var j = 0; j < other.length; j++) {
        if (other[j].id === id) {
          problems.push(element + ': "' + id + '" is a ' + ELEMENTS[e] + ' template');
          return null;
        }
      }
    }
    problems.push(element + ': "' + id + '" is not a published template');
    return null;
  }

  function readOverrides(element, given, problems) {
    var out = {};
    if (given === undefined) return out;
    if (!given || typeof given !== 'object' || Array.isArray(given)) {
      problems.push(element + ': overrides must be an object');
      return out;
    }
    var allowed = OVERRIDES[element] || {};
    Object.keys(given)
      .sort()
      .forEach(function (k) {
        if (!hasOwn(allowed, k)) {
          problems.push(
            element +
              ': "' +
              k +
              '" cannot be adjusted' +
              (Object.keys(allowed).length ? ' (only ' + Object.keys(allowed).join(', ') + ')' : '')
          );
          return;
        }
        var v = allowed[k][0](given[k]);
        if (v === undefined) problems.push(element + '.' + k + ': expected ' + allowed[k][1]);
        else out[k] = v;
      });
    return out;
  }

  function resolve(choices, data) {
    var problems = [];
    var lib = data || pageData();
    if (!lib || !lib.templates) throw ResolveError(['no library data (load picker/data or pass it)']);
    if (!choices || typeof choices !== 'object') throw ResolveError(['expected the choices object']);
    Object.keys(choices).forEach(function (k) {
      if (['name', 'selections', 'project', 'motion', 'autoFilled', 'leaveToAI'].indexOf(k) === -1)
        problems.push('unknown choice "' + k + '"');
    });
    var project = choices.project === undefined ? {} : choices.project;
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      problems.push('project must be an object');
      project = {};
    }
    Object.keys(project).forEach(function (k) {
      if (k !== 'type' && k !== 'contrast') problems.push('project: unknown setting "' + k + '"');
    });
    var type = project.type === undefined ? 'web-app' : project.type;
    var level = project.contrast === undefined ? 'AA' : project.contrast;
    var motion = choices.motion === undefined ? 'subtle' : choices.motion;
    if (PROJECT_TYPES.indexOf(type) === -1) problems.push('project.type: expected one of ' + PROJECT_TYPES.join(', '));
    if (CONTRAST.indexOf(level) === -1) problems.push('project.contrast: expected AA or AAA');
    if (MOTION.indexOf(motion) === -1) problems.push('motion: expected one of ' + MOTION.join(', '));

    var sel = choices.selections;
    if (!sel || typeof sel !== 'object' || Array.isArray(sel))
      throw ResolveError(problems.concat(['selections must be an object']));
    Object.keys(sel).forEach(function (k) {
      if (ELEMENTS.indexOf(k) === -1) problems.push('selections: "' + k + '" is not an element');
    });

    var T = {};
    var O = {};
    var selections = {};
    ELEMENTS.forEach(function (element) {
      var s = sel[element];
      if (!hasOwn(sel, element) || !s || typeof s !== 'object' || typeof s.template !== 'string') {
        problems.push(element + ': no template chosen');
        return;
      }
      Object.keys(s).forEach(function (k) {
        if (k !== 'template' && k !== 'overrides') problems.push(element + ': unknown field "' + k + '"');
      });
      T[element] = find(lib.templates, element, s.template, problems);
      O[element] = readOverrides(element, s.overrides, problems);
      selections[element] = { template: s.template };
      if (Object.keys(O[element]).length) selections[element].overrides = O[element];
    });
    if (problems.length) throw ResolveError(problems);

    // Colors: both modes and the three ramps from the primary (and secondary) color.
    var c = T.colors.tokens.color || {};
    var primary = O.colors.primary || (c.primary && c.primary.$value && hexValue(c.primary.$value.hex));
    var secondary = O.colors.secondary || (c.secondary && c.secondary.$value && hexValue(c.secondary.$value.hex));
    if (!primary) problems.push('colors: the template has no primary color');
    // No secondary in the template means "derive one"; a secondary that cannot be read is an error.
    if (!O.colors.secondary && c.secondary !== undefined && !secondary)
      problems.push('colors: the template secondary color is not #rrggbb');
    var colorTokens = null;
    if (primary) {
      var d = modes.derive(primary, secondary ? { secondary: secondary } : undefined);
      colorTokens = { light: d.light, dark: d.dark, ramps: d.ramps };
    }

    var fonts = fontRoles(T.fonts, O.fonts, problems);
    var lh = (T['type-scale'].tokens && T['type-scale'].tokens.lineHeight) || {};
    // The template's own Arabic line height must be a default R-091 allows; only an explicit adjustment may leave 1.6..1.8.
    var arDefault = lh.ar && lh.ar.$value;
    if (!hasOwn(O['type-scale'], 'line-height-ar') && !(isNum(arDefault) && arDefault >= 1.6 && arDefault <= 1.8)) {
      problems.push('type-scale: the template Arabic line height must be from 1.6 to 1.8 (R-091)');
    }
    fonts.lineHeight = {
      ar: hasOwn(O['type-scale'], 'line-height-ar')
        ? O['type-scale']['line-height-ar']
        : plain(lh.ar, 'type-scale.lineHeight.ar', problems),
      en: hasOwn(O['type-scale'], 'line-height-en')
        ? O['type-scale']['line-height-en']
        : plain(lh.en, 'type-scale.lineHeight.en', problems)
    };

    var r = T.radius.tokens.radius || {};
    var radius = {};
    ['sm', 'md', 'lg'].forEach(function (k) {
      radius[k] = hasOwn(O.radius, k) ? O.radius[k] : px(r[k], 'radius.' + k, problems);
    });
    radius.full = 9999;

    var sh = T.shadows.tokens.shadow || {};
    var shadow = {};
    ['light', 'dark'].forEach(function (m) {
      shadow[m] = {};
      ['sm', 'md', 'lg'].forEach(function (k) {
        shadow[m][k] = shadowLayers(sh[m] && sh[m][k], 'shadows.' + m + '.' + k, problems);
      });
    });

    var dir = T.direction;
    var dx = dir.extras || {};
    var direction = plain(dir.tokens.direction, 'direction', problems);
    if (!hasOwn(LANGUAGE, direction)) problems.push('direction: expected rtl, ltr or both');
    var ix = T.icons.extras || {};

    var identity = {
      schemaVersion: 1,
      name: choices.name,
      project: { language: LANGUAGE[direction], direction: direction, platform: 'web', type: type, contrast: level },
      tokens: {
        color: colorTokens,
        font: fonts,
        typeScale: typeScale(T['type-scale'], O['type-scale'], problems),
        radius: radius,
        shadow: shadow,
        spacing: spacing(T.spacing, O.spacing, problems)
      },
      extensions: {
        icons: {
          library: ix.library,
          weight: ix.weight,
          fill: O.icons.fill || ix.fill,
          container: O.icons.container || ix.container
        },
        components: { button: T.buttons.id, card: T.cards.id },
        motion: motion,
        numerals: O.direction.numerals || dx.numerals,
        calendar: O.direction.calendar || dx.calendar,
        rtl: {
          logicalProperties: true,
          mirror: Array.isArray(dx.mirror) ? dx.mirror.slice() : dx.mirror,
          neverMirror: Array.isArray(dx.neverMirror) ? dx.neverMirror.slice() : dx.neverMirror
        }
      },
      selections: selections,
      autoFilled: Array.isArray(choices.autoFilled)
        ? choices.autoFilled.slice()
        : choices.autoFilled === undefined
          ? []
          : choices.autoFilled,
      leaveToAI: Array.isArray(choices.leaveToAI)
        ? choices.leaveToAI.slice()
        : choices.leaveToAI === undefined
          ? []
          : choices.leaveToAI
    };
    if (problems.length) throw ResolveError(problems);

    // The returned identity always passes the identity checker (what the save servers also run).
    var verdict = validate.check('identity', identity);
    if (!verdict.valid) {
      throw ResolveError(
        verdict.errors.slice(0, 10).map(function (e) {
          return (e.instancePath || '/') + ': ' + e.message;
        })
      );
    }
    return identity;
  }

  return { resolve: resolve, ResolveError: ResolveError, ELEMENTS: ELEMENTS, OVERRIDES: Object.keys(OVERRIDES) };
});
