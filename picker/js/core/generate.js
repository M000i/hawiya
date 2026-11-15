/*
 * Generator. Works in the browser (window.Hawiya.generate) and in Node (module.exports).
 * No dates or randomness anywhere: same input, same bytes (R-077).
 *
 * 1. generate.valueFiles(identity)  (task 1.8) - the final generator, from a full identity (schema/identity.schema.json):
 *      -> { "identity.json", "tokens.json", "tokens.css", "theme.css" }   (strings, each ending with one newline)
 *    The identity is checked first with validate.js (browser: load schemas.js and validate.js before calling it);
 *    an invalid identity throws, with the checker's errors on error.errors. Nothing is written from unchecked data.
 *
 * 2. generate(input) / generate.derive(input)  (task 0.3) - the PROTOTYPE generator still used by the phase-0 page:
 *      Input: { name, primary: "#rrggbb", fontFamily: string, radius: integer px 0..64 }
 *      Output: { "identity.json" (prototype format), "DESIGN.md" }
 *    It is removed when the final page export lands (task 2.21, backlog B-013).
 */
(function (root, factory) {
  var api;
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    api = factory(function () {
      return { validate: require('./validate.js'), schemas: require('./schemas.js') };
    });
    module.exports = api;
  } else {
    api = factory(function () {
      var H = root.Hawiya || {};
      return { validate: H.validate, schemas: H.schemas };
    });
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.generate = api;
  }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var SCHEMA_VERSION = '0.1-prototype';
  /* Pure black/white guarantee >= 4.58:1 against any sRGB color. Softer darks (e.g. #111827) do not. */
  var DARK_TEXT = '#000000';
  var LIGHT_TEXT = '#ffffff';
  var AA = 4.5;
  var NEUTRAL = '#ffffff';
  var ON_NEUTRAL = '#111827';

  /* ---------- validation ---------- */

  function fail(msg) {
    throw new Error('Hawiya.generate: ' + msg);
  }

  function check(input) {
    if (!input || typeof input !== 'object') fail('input must be an object');
    if (typeof input.primary !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.primary)) {
      fail('primary must be a #rrggbb hex color');
    }
    if (typeof input.fontFamily !== 'string' || !/^[A-Za-z0-9 \-]{1,60}$/.test(input.fontFamily)) {
      fail('fontFamily must be a plain font name (letters, digits, spaces, hyphens)');
    }
    if (typeof input.radius !== 'number' || !Number.isInteger(input.radius) || input.radius < 0 || input.radius > 64) {
      fail('radius must be an integer between 0 and 64');
    }
    if (input.name != null && typeof input.name !== 'string') fail('name must be a string');
  }

  /*
   * One line, no control or bidi-override characters, no lone surrogates, at most 80 code points.
   * Safe in YAML (JSON-quoted) and in markdown prose.
   */
  function cleanName(name) {
    var s = String(name || '')
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    // Drop lone surrogates without the ES2018 `u` flag: Array.from splits by code point,
    // so a valid pair stays one 2-unit string and only an unpaired half is a 1-unit match.
    s = Array.from(s)
      .filter(function (ch) {
        return !/^[\ud800-\udfff]$/.test(ch);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    s = Array.from(s).slice(0, 80).join('').trim();
    return s || 'Hawiya identity';
  }

  /* Markdown-inert version of the name for prose (no headings, emphasis, links, code). */
  function proseName(name) {
    return name.replace(/[\\`*_#\[\]<>|]/g, '');
  }

  /* ---------- WCAG contrast (prototype copy; the shared module arrives in task 1.2) ---------- */

  function channel(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /* ---------- derived tokens ---------- */

  function derive(input) {
    var primary = input.primary.toLowerCase();
    var withLight = contrast(primary, LIGHT_TEXT);
    var withDark = contrast(primary, DARK_TEXT);
    var onPrimary = withLight >= withDark ? LIGHT_TEXT : DARK_TEXT;
    /* Primary may color text on the white surface (links, secondary button) only if it reaches AA there. */
    var primaryOnSurface = contrast(primary, NEUTRAL);
    var accentIsPrimary = primaryOnSurface >= AA;
    var r = input.radius;
    return {
      name: cleanName(input.name),
      primary: primary,
      onPrimary: onPrimary,
      onPrimaryContrast: round2(Math.max(withLight, withDark)),
      accentText: accentIsPrimary ? primary : ON_NEUTRAL,
      accentTextToken: accentIsPrimary ? 'primary' : 'on-surface',
      accentTextContrast: round2(accentIsPrimary ? primaryOnSurface : contrast(ON_NEUTRAL, NEUTRAL)),
      fontFamily: input.fontFamily,
      radius: { sm: Math.round(r / 2), md: r, lg: Math.round(r * 1.5) }
    };
  }

  /* ---------- identity.json ---------- */

  function identityJson(d, input) {
    var doc = {
      schemaVersion: SCHEMA_VERSION,
      name: d.name,
      project: { language: 'ar', direction: 'rtl' },
      tokens: {
        color: {
          primary: d.primary,
          onPrimary: d.onPrimary,
          onPrimaryContrast: d.onPrimaryContrast,
          accentText: d.accentText,
          accentTextContrast: d.accentTextContrast,
          neutral: NEUTRAL,
          onNeutral: ON_NEUTRAL
        },
        font: { family: d.fontFamily, fallback: 'system-ui, sans-serif', lineHeight: 1.7 },
        radius: { sm: d.radius.sm, md: d.radius.md, lg: d.radius.lg, unit: 'px' }
      },
      selections: {
        color: d.primary,
        font: d.fontFamily,
        radius: input.radius
      },
      leaveToAI: ['spacing', 'elevation', 'icons', 'motion']
    };
    return JSON.stringify(doc, null, 2) + '\n';
  }

  /* ---------- DESIGN.md ---------- */

  function q(s) {
    return JSON.stringify(String(s)); // JSON strings are valid YAML double-quoted scalars
  }

  function designMd(d) {
    var y = [];
    y.push('---');
    y.push('version: alpha');
    y.push('name: ' + q(d.name));
    y.push('description: ' + q('Arabic-first (RTL) UI identity generated by Hawiya.'));
    y.push('omitted:');
    y.push('  - section: spacing');
    y.push('    reason: ' + q('Not chosen in this identity yet; keep spacing consistent and generous.'));
    y.push('colors:');
    y.push('  primary: ' + q(d.primary));
    y.push('  on-primary: ' + q(d.onPrimary));
    y.push('  surface: ' + q(NEUTRAL));
    y.push('  on-surface: ' + q(ON_NEUTRAL));
    y.push('typography:');
    [
      ['headline-lg', 32, 700],
      ['headline-md', 24, 700],
      ['body-lg', 18, 400],
      ['body-md', 16, 400],
      ['label-md', 14, 700]
    ].forEach(function (t) {
      y.push('  ' + t[0] + ':');
      y.push('    fontFamily: ' + q(d.fontFamily));
      y.push('    fontSize: ' + q(t[1] + 'px'));
      y.push('    fontWeight: ' + t[2]);
      y.push('    lineHeight: 1.7');
    });
    y.push('rounded:');
    y.push('  sm: ' + q(d.radius.sm + 'px'));
    y.push('  md: ' + q(d.radius.md + 'px'));
    y.push('  lg: ' + q(d.radius.lg + 'px'));
    y.push('components:');
    y.push('  button-primary:');
    y.push('    backgroundColor: ' + q('{colors.primary}'));
    y.push('    textColor: ' + q('{colors.on-primary}'));
    y.push('    typography: ' + q('{typography.label-md}'));
    y.push('    rounded: ' + q('{rounded.md}'));
    y.push('  button-secondary:');
    y.push('    backgroundColor: ' + q('{colors.surface}'));
    y.push('    textColor: ' + q('{colors.' + d.accentTextToken + '}'));
    y.push('    typography: ' + q('{typography.label-md}'));
    y.push('    rounded: ' + q('{rounded.md}'));
    y.push('  card:');
    y.push('    backgroundColor: ' + q('{colors.surface}'));
    y.push('    textColor: ' + q('{colors.on-surface}'));
    y.push('    rounded: ' + q('{rounded.lg}'));
    y.push('  input-field:');
    y.push('    backgroundColor: ' + q('{colors.surface}'));
    y.push('    textColor: ' + q('{colors.on-surface}'));
    y.push('    typography: ' + q('{typography.body-md}'));
    y.push('    rounded: ' + q('{rounded.md}'));
    y.push('---');

    var n = proseName(d.name);
    var b = [];
    b.push('# ' + n);
    b.push('');
    b.push('## Overview');
    b.push('');
    b.push('An Arabic-first interface (right-to-left). Calm, clear and trustworthy: one accent color, one readable typeface, consistent corners. Follow the tokens above exactly; where this file is silent, stay plain and consistent rather than decorative.');
    b.push('');
    b.push('## Colors');
    b.push('');
    if (d.accentTextToken === 'primary') {
      b.push('- **Primary (' + d.primary + '):** the single accent. Use it for the main action on each screen, links and focus rings. As text on surface it reaches ' + d.accentTextContrast.toFixed(2) + ':1.');
    } else {
      b.push('- **Primary (' + d.primary + '):** the single accent, used as a fill: the main action on each screen and focus rings. It is too light for text on surface, so links use on-surface with an underline.');
    }
    b.push('- **On-primary (' + d.onPrimary + '):** text and icons placed on primary. Contrast ' + d.onPrimaryContrast.toFixed(2) + ':1 (WCAG AA needs 4.5:1).');
    b.push('- **Surface (' + NEUTRAL + '):** page, card and input backgrounds.');
    b.push('- **On-surface (' + ON_NEUTRAL + '):** body text and headings.');
    b.push('');
    b.push('## Typography');
    b.push('');
    b.push('All text uses **' + d.fontFamily + '**, falling back to `system-ui, sans-serif`. Load it from Google Fonts. Line height is 1.7 for every level so Arabic diacritics and ascenders never collide. Headlines use weight 700, body uses 400.');
    b.push('');
    b.push('## Shapes');
    b.push('');
    b.push('Corner radius scale: sm ' + d.radius.sm + 'px, md ' + d.radius.md + 'px (buttons, inputs), lg ' + d.radius.lg + 'px (cards and containers). A button is never rounder than the card that contains it.');
    b.push('');
    b.push('## Components');
    b.push('');
    b.push('- **Primary button:** primary background, on-primary text, label-md, rounded md.');
    b.push('- **Secondary button:** surface background, ' + d.accentTextToken + ' text, 1px primary border, rounded md.');
    b.push('- **Card:** surface background, rounded lg, subtle 1px border.');
    b.push('- **Input field:** surface background, 1px border, rounded md, focus ring in primary.');
    b.push('');
    b.push("## Do's and Don'ts");
    b.push('');
    b.push('- Do use the primary color for one main action per screen.');
    b.push('- Do keep WCAG AA contrast (4.5:1) for all text.');
    b.push('- Do use CSS logical properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`), never `left` / `right`.');
    b.push("- Don't add letter-spacing, uppercase or italic to Arabic text.");
    b.push("- Don't introduce extra fonts or accent colors not listed here.");
    b.push('');
    b.push('## Arabic & Direction');
    b.push('');
    b.push('- Set `<html lang="ar" dir="rtl">`.');
    b.push('- Mirror directional icons (arrows, chevrons) in RTL; do not mirror clocks, play buttons or checkmarks.');
    b.push('- Keep Latin snippets such as emails and URLs in `dir="ltr"` inside RTL text.');
    b.push('');

    return y.join('\n') + '\n\n' + b.join('\n');
  }

  function generate(input) {
    check(input);
    var d = derive(input);
    return {
      'identity.json': identityJson(d, input),
      'DESIGN.md': designMd(d)
    };
  }

  /* Same derived values the files use; the page preview reads these so it never disagrees with the export. */
  generate.derive = function (input) {
    check(input);
    return derive(input);
  };

  /* =================================================================================================
   * Final generator (task 1.8): identity.json, tokens.json (DTCG 2025.10), tokens.css, theme.css (Tailwind v4)
   * ================================================================================================= */

  var hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  var ROLES = ['primary', 'onPrimary', 'secondary', 'onSecondary', 'accentText', 'background', 'surface', 'onSurface',
    'mutedText', 'border', 'success', 'warning', 'danger', 'info'];
  var RAMPS = ['primary', 'secondary', 'neutral'];
  var RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
  var FONT_ROLES = ['heading', 'body', 'numerals'];
  var SIZES = ['sm', 'md', 'lg'];
  var RADII = ['sm', 'md', 'lg', 'full'];
  var EXT_KEY = 'hawiya'; // $extensions key in tokens.json (DTCG: vendor-specific key)

  var DARK_MEDIA = '@media (prefers-color-scheme: dark)';
  var DARK_AUTO = ':root:not([data-theme="light"])';
  var DARK_FORCED = ':root[data-theme="dark"]';
  var SHADOW_VAR = '--hawiya-shadow-'; // runtime shadow variables used by theme.css
  var GENERATED = 'Generated by Hawiya from identity.json. Do not edit by hand: change the identity and export again.';

  function kebab(s) {
    return s.replace(/[A-Z]/g, function (c) {
      return '-' + c.toLowerCase();
    });
  }

  /* ---------- checking and identity.json ---------- */

  function checkIdentity(identity) {
    var d = deps();
    if (!d.validate || !d.schemas) fail('load schemas.js and validate.js before generate.js to build the export files');
    var r = d.validate.check('identity', identity);
    if (!r.valid) {
      var e = new Error(
        'Hawiya.generate: identity is not valid: ' +
          r.errors
            .slice(0, 5)
            .map(function (x) {
              return (x.instancePath || '(root)') + ' ' + x.message;
            })
            .join('; ')
      );
      e.errors = r.errors;
      throw e;
    }
    return d.schemas.identity;
  }

  function deref(rootSchema, s) {
    var guard = 0;
    while (s && typeof s === 'object' && typeof s.$ref === 'string' && guard++ < 20) {
      var node = rootSchema;
      s.$ref.slice(2).split('/').forEach(function (part) {
        node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      });
      s = node;
    }
    return s;
  }

  // A copy of a checked value with object keys in the schema's order; map keys (selections, overrides) follow the
  // schema's enum order when there is one, otherwise code-unit order. So the input's key order never changes a byte.
  function canonical(rootSchema, schema, value) {
    var s = deref(rootSchema, schema) || {};
    if (Array.isArray(value)) {
      return value.map(function (v) {
        return canonical(rootSchema, s.items, v);
      });
    }
    if (value === null || typeof value !== 'object') return value;
    var props = s.properties || {};
    var out = {};
    Object.keys(props).forEach(function (k) {
      if (hasOwn(value, k)) out[k] = canonical(rootSchema, props[k], value[k]);
    });
    var rest = Object.keys(value).filter(function (k) {
      return !hasOwn(props, k);
    });
    var names = s.propertyNames ? deref(rootSchema, s.propertyNames) : null;
    var order = names && Array.isArray(names.enum) ? names.enum : null;
    rest.sort(function (a, b) {
      if (order) return order.indexOf(a) - order.indexOf(b);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    rest.forEach(function (k) {
      out[k] = canonical(rootSchema, s.additionalProperties, value[k]);
    });
    return out;
  }

  /* ---------- shared value helpers ---------- */

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rem(px) {
    return px / 16; // division by a power of two: exact, so the printed number is the same in every engine
  }

  // Font names first (Latin before Arabic: Latin text then uses the chosen Latin font and Arabic letters, which it
  // lacks, fall through to the Arabic font), then the generic families.
  function familyList(ref) {
    var names = [];
    if (ref.latin) names.push(ref.latin);
    if (ref.arabic && ref.arabic !== ref.latin) names.push(ref.arabic);
    return { names: names, fallback: ref.fallback.slice() };
  }

  // Names for the type scale, relative to the base size: ..., 2xs, xs, sm, base, lg, xl, 2xl, 3xl, ...
  function sizeNames(ts) {
    var steps = ts.steps;
    var baseIdx = steps.indexOf(ts.base);
    if (baseIdx === -1) {
      baseIdx = 0;
      for (var i = 1; i < steps.length; i++) if (Math.abs(steps[i] - ts.base) < Math.abs(steps[baseIdx] - ts.base)) baseIdx = i;
    }
    return steps.map(function (_, i) {
      var d = i - baseIdx;
      if (d === 0) return 'base';
      if (d === -1) return 'sm';
      if (d === -2) return 'xs';
      if (d < -2) return -d - 1 + 'xs';
      if (d === 1) return 'lg';
      if (d === 2) return 'xl';
      return d - 1 + 'xl';
    });
  }

  function mainLineHeight(id) {
    return id.project.language === 'en' ? id.tokens.font.lineHeight.en : id.tokens.font.lineHeight.ar;
  }

  /* ---------- tokens.json (DTCG Format Module 2025.10 + Color Module 2025.10) ---------- */

  function dtcgColor(hex, alpha) {
    var c = rgb(hex);
    var v = {
      colorSpace: 'srgb',
      components: c.map(function (x) {
        return Number((x / 255).toFixed(4));
      })
    };
    if (alpha !== undefined && alpha !== 1) v.alpha = alpha;
    v.hex = hex;
    return v;
  }

  function dim(value, unit) {
    return { value: value, unit: unit };
  }

  function dtcgShadow(layers) {
    if (layers.length === 0) {
      // DTCG has no "none": a fully transparent, zero-size shadow draws nothing.
      return { color: dtcgColor('#000000', 0), offsetX: dim(0, 'px'), offsetY: dim(0, 'px'), blur: dim(0, 'px'), spread: dim(0, 'px') };
    }
    return layers.map(function (l) {
      var v = { color: dtcgColor(l.color, l.alpha), offsetX: dim(l.x, 'px'), offsetY: dim(l.y, 'px'), blur: dim(l.blur, 'px'), spread: dim(l.spread, 'px') };
      if (l.inset === true) v.inset = true;
      return v;
    });
  }

  function tokensJson(id) {
    var t = id.tokens;
    var color = { $type: 'color' };
    ['light', 'dark'].forEach(function (mode) {
      var g = { $description: 'Colors of the ' + mode + ' mode. color.light and color.dark have the same names; use one set per mode.' };
      ROLES.forEach(function (role) {
        g[kebab(role)] = { $value: dtcgColor(t.color[mode][role]) };
      });
      color[mode] = g;
    });
    color.ramp = { $description: 'Eleven-step ramps (50 lightest, 950 darkest), shared by both modes.' };
    RAMPS.forEach(function (r) {
      var g = {};
      RAMP_STEPS.forEach(function (step, i) {
        g[step] = { $value: dtcgColor(t.color.ramps[r][i]) };
      });
      color.ramp[r] = g;
    });

    var family = { $type: 'fontFamily' };
    FONT_ROLES.forEach(function (role) {
      var ref = t.font[role];
      var fl = familyList(ref);
      var tok = { $value: fl.names.concat(fl.fallback) };
      var ext = {};
      if (ref.arabic) ext.arabic = ref.arabic;
      if (ref.latin) ext.latin = ref.latin;
      if (hasOwn(ref, 'latinSizeAdjust')) ext.latinSizeAdjust = ref.latinSizeAdjust;
      if (hasOwn(ref, 'easternArabicDigits')) ext.easternArabicDigits = ref.easternArabicDigits;
      tok.$extensions = {};
      tok.$extensions[EXT_KEY] = ext;
      family[role] = tok;
    });
    var size = { $type: 'dimension', $description: 'Type scale; base is the body size.' };
    var names = sizeNames(t.typeScale);
    t.typeScale.steps.forEach(function (px, i) {
      size[names[i]] = { $value: dim(rem(px), 'rem') };
    });
    var lineHeight = {
      $type: 'number',
      $description: 'Line height as a multiple of the font size, for Arabic (ar) and Latin (en) text.',
      ar: { $value: t.font.lineHeight.ar },
      en: { $value: t.font.lineHeight.en }
    };

    var radius = { $type: 'dimension' };
    RADII.forEach(function (r) {
      radius[r] = { $value: dim(t.radius[r], 'px') };
    });

    var shadow = { $type: 'shadow' };
    ['light', 'dark'].forEach(function (mode) {
      var g = {};
      SIZES.forEach(function (sz) {
        var layers = t.shadow[mode][sz];
        g[sz] = { $value: dtcgShadow(layers) };
        if (layers.length === 0) g[sz].$description = 'No shadow.';
      });
      shadow[mode] = g;
    });

    var scale = {};
    t.spacing.scale.forEach(function (px, i) {
      scale[String(i)] = { $value: dim(px, 'px') };
    });
    var space = { $type: 'dimension', unit: { $value: dim(t.spacing.unit, 'px') }, scale: scale };

    var ext = {
      schemaVersion: id.schemaVersion,
      name: id.name,
      project: id.project,
      extensions: id.extensions,
      selections: id.selections,
      autoFilled: id.autoFilled,
      leaveToAI: id.leaveToAI
    };
    var doc = {
      $description:
        'Design tokens of the Hawiya identity \u201c' + id.name + '\u201d (DTCG format 2025.10). ' + GENERATED +
        ' Light and dark values sit in sibling groups (color.light / color.dark, shadow.light / shadow.dark) with the same names.',
      color: color,
      font: { family: family, size: size, 'line-height': lineHeight },
      radius: radius,
      shadow: shadow,
      space: space,
      $extensions: {}
    };
    doc.$extensions[EXT_KEY] = ext;
    return JSON.stringify(doc, null, 2) + '\n';
  }

  /* ---------- CSS ---------- */

  function cssFont(ref) {
    var fl = familyList(ref);
    return fl.names
      .map(function (n) {
        return '"' + n + '"'; // familyName in the schema allows only letters, digits, spaces and hyphens
      })
      .concat(fl.fallback)
      .join(', ');
  }

  function cssShadow(layers) {
    // Not 'none': Tailwind and authors combine shadows in one box-shadow list (rings, focus outlines), and a list
    // containing 'none' is invalid, which would drop the whole box-shadow. This transparent zero shadow draws nothing.
    if (layers.length === 0) return '0 0 #0000';
    return layers
      .map(function (l) {
        var c = rgb(l.color);
        return (l.inset === true ? 'inset ' : '') + l.x + 'px ' + l.y + 'px ' + l.blur + 'px ' + l.spread + 'px rgb(' + c.join(' ') + ' / ' + l.alpha + ')';
      })
      .join(', ');
  }

  function decls(pairs, indent) {
    return pairs.map(function (p) {
      return p.comment ? indent + '/* ' + p.comment + ' */' : indent + p[0] + ': ' + p[1] + ';';
    });
  }

  function colorPairs(t, mode) {
    var out = [{ comment: 'colors (' + mode + ')' }];
    ROLES.forEach(function (role) {
      out.push(['--color-' + kebab(role), t.color[mode][role]]);
    });
    return out;
  }

  function shadowPairs(t, mode, prefix) {
    var out = [{ comment: 'shadows (' + mode + ')' }];
    SIZES.forEach(function (sz) {
      out.push([prefix + sz, cssShadow(t.shadow[mode][sz])]);
    });
    return out;
  }

  function modePairs(t, mode) {
    return colorPairs(t, mode).concat(shadowPairs(t, mode, '--shadow-'));
  }

  function rampPairs(t) {
    var out = [{ comment: 'color ramps, same in both modes (50 lightest, 950 darkest)' }];
    RAMPS.forEach(function (r) {
      RAMP_STEPS.forEach(function (step, i) {
        out.push(['--color-' + r + '-' + step, t.color.ramps[r][i]]);
      });
    });
    return out;
  }

  function radiusPairs(t) {
    var out = [{ comment: 'corner radius' }];
    RADII.forEach(function (r) {
      out.push(['--radius-' + r, t.radius[r] + 'px']);
    });
    return out;
  }

  function tokensCss(id) {
    var t = id.tokens;
    var root = [['color-scheme', 'light']].concat(modePairs(t, 'light'), rampPairs(t));
    root.push({ comment: 'fonts: chosen families, then generic fallbacks' });
    FONT_ROLES.forEach(function (role) {
      root.push(['--font-' + role, cssFont(t.font[role])]);
    });
    FONT_ROLES.forEach(function (role) {
      if (hasOwn(t.font[role], 'latinSizeAdjust')) root.push(['--font-' + role + '-latin-size-adjust', String(t.font[role].latinSizeAdjust)]);
    });
    root.push({ comment: 'line height: Arabic text, Latin text, and the default for this project' });
    root.push(['--line-height-ar', String(t.font.lineHeight.ar)]);
    root.push(['--line-height-en', String(t.font.lineHeight.en)]);
    root.push(['--line-height', String(mainLineHeight(id))]);
    root.push({ comment: 'type scale (base = body text)' });
    var names = sizeNames(t.typeScale);
    t.typeScale.steps.forEach(function (px, i) {
      root.push(['--font-size-' + names[i], rem(px) + 'rem']);
    });
    root = root.concat(radiusPairs(t));
    root.push({ comment: 'spacing: --space-unit and the allowed steps' });
    root.push(['--space-unit', t.spacing.unit + 'px']);
    t.spacing.scale.forEach(function (px, i) {
      root.push(['--space-' + i, px + 'px']);
    });

    var dark = [['color-scheme', 'dark']].concat(modePairs(t, 'dark'));
    var lines = [
      '/*',
      ' * Hawiya design tokens: CSS variables for the light and dark modes.',
      ' * ' + GENERATED,
      ' * Light is the default. Dark applies when the system prefers dark (unless <html data-theme="light">)',
      ' * and always with <html data-theme="dark">. Use logical properties (inline-start / inline-end) for layout.',
      ' */',
      ':root {'
    ];
    lines = lines.concat(decls(root, '  '), ['}', '', DARK_MEDIA + ' {', '  ' + DARK_AUTO + ' {'], decls(dark, '    '), ['  }', '}', '', DARK_FORCED + ' {'], decls(dark, '  '), ['}']);
    return lines.join('\n') + '\n';
  }

  function themeCss(id) {
    var t = id.tokens;
    var theme = colorPairs(t, 'light').concat(rampPairs(t));
    theme.push({ comment: 'shadows: Tailwind copies @theme shadow values into each utility at build time, so they point at' });
    theme.push({ comment: 'runtime variables (set below) that switch with the mode' });
    SIZES.forEach(function (sz) {
      theme.push(['--shadow-' + sz, 'var(' + SHADOW_VAR + sz + ')']);
    });
    theme.push({ comment: 'fonts (font-sans is the default text font)' });
    theme.push(['--font-sans', cssFont(t.font.body)]);
    FONT_ROLES.forEach(function (role) {
      theme.push(['--font-' + role, cssFont(t.font[role])]);
    });
    theme.push({ comment: 'type scale, each size with the project line height' });
    var names = sizeNames(t.typeScale);
    var lh = String(mainLineHeight(id));
    t.typeScale.steps.forEach(function (px, i) {
      theme.push(['--text-' + names[i], rem(px) + 'rem']);
      theme.push(['--text-' + names[i] + '--line-height', lh]);
    });
    theme.push({ comment: 'line height for Arabic (leading-ar) and Latin (leading-en) text' });
    theme.push(['--leading-ar', String(t.font.lineHeight.ar)]);
    theme.push(['--leading-en', String(t.font.lineHeight.en)]);
    theme = theme.concat(radiusPairs(t));
    theme.push({ comment: 'spacing unit: p-4 = 4 \u00d7 --spacing' });
    theme.push(['--spacing', t.spacing.unit + 'px']);

    var light = [['color-scheme', 'light']].concat(shadowPairs(t, 'light', SHADOW_VAR));
    var dark = [['color-scheme', 'dark']].concat(colorPairs(t, 'dark'), shadowPairs(t, 'dark', SHADOW_VAR));
    var lines = [
      '/*',
      ' * Hawiya theme for Tailwind CSS v4. Import it after Tailwind:',
      ' *   @import "tailwindcss";',
      ' *   @import "./design/theme.css";',
      ' * ' + GENERATED,
      ' * Colors and shadows switch to the dark mode with the system setting (unless <html data-theme="light">)',
      ' * or with <html data-theme="dark">; utilities such as bg-primary and shadow-md follow on their own,',
      ' * and the dark: variant below follows the same rule (it replaces any other dark: variant of the project).',
      ' */',
      '@theme {'
    ];
    lines = lines.concat(
      decls(theme, '  '),
      [
        '}',
        '',
        '@custom-variant dark {',
        '  ' + DARK_MEDIA + ' {',
        '    &:where(' + DARK_AUTO + ', ' + DARK_AUTO + ' *) {',
        '      @slot;',
        '    }',
        '  }',
        '  &:where([data-theme="dark"], [data-theme="dark"] *) {',
        '    @slot;',
        '  }',
        '}',
        '',
        '@layer theme {',
        '  :root {'
      ],
      decls(light, '    '),
      ['  }', '', '  ' + DARK_MEDIA + ' {', '    ' + DARK_AUTO + ' {'],
      decls(dark, '      '),
      ['    }', '  }', '', '  ' + DARK_FORCED + ' {'],
      decls(dark, '    '),
      ['  }', '}']
    );
    return lines.join('\n') + '\n';
  }

  function valueFiles(identity) {
    var schema = checkIdentity(identity);
    var id = canonical(schema, schema, identity);
    return {
      'identity.json': JSON.stringify(id, null, 2) + '\n',
      'tokens.json': tokensJson(id),
      'tokens.css': tokensCss(id),
      'theme.css': themeCss(id)
    };
  }

  generate.valueFiles = valueFiles;
  generate.sizeNames = sizeNames;

  return generate;
});
