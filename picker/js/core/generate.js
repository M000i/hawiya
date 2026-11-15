/*
 * Generator. Works in the browser (window.Hawiya.generate) and in Node (module.exports).
 * No dates or randomness anywhere: same input, same bytes (R-077).
 *
 * 1. generate.valueFiles(identity)  (task 1.8) - the final generator, from a full identity (schema/identity.schema.json):
 *      -> { "identity.json", "tokens.json", "tokens.css", "theme.css" }   (strings, each ending with one newline)
 *    The identity is checked first with validate.js (browser: load schemas.js, validate.js and contrast.js first);
 *    an invalid identity throws, with the checker's errors on error.errors. Nothing is written from unchecked data.
 *
 *    generate.designMd(identity)  (task 1.9) - the full DESIGN.md (format: @google/design.md, version alpha), from the
 *    same checked identity. Browser: also load contrast.js. generate.uiColors(colorSet) gives the focus-ring and
 *    control-border colors it uses (both reach 3:1 against background and surface when the identity allows it).
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
      return { validate: require('./validate.js'), schemas: require('./schemas.js'), contrast: require('./contrast.js') };
    });
    module.exports = api;
  } else {
    api = factory(function () {
      var H = root.Hawiya || {};
      return { validate: H.validate, schemas: H.schemas, contrast: H.contrast };
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
      var ui = uiColors(t.color[mode]);
      g['focus-ring'] = { $value: dtcgColor(ui.focusRing), $description: 'Keyboard focus outline; reaches 3:1 against background and surface when the identity allows it.' };
      g['control-border'] = { $value: dtcgColor(ui.controlBorder), $description: 'Boundaries of inputs and secondary buttons (not the decorative border).' };
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
    var ui = uiColors(t.color[mode]);
    out.push(['--color-focus-ring', ui.focusRing]);
    out.push(['--color-control-border', ui.controlBorder]);
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

  /* =================================================================================================
   * DESIGN.md (task 1.9): front matter tokens (format "alpha" of @google/design.md) + written guidance
   * ================================================================================================= */

  // Arabic text kept as code points so this source file stays plain ASCII (output must not depend on page charset).
  function cp() {
    return String.fromCharCode.apply(null, arguments);
  }
  var AR_SECTION = 'Arabic & Direction (' + cp(0x627, 0x644, 0x639, 0x631, 0x628, 0x64a, 0x20, 0x648, 0x627, 0x644, 0x627, 0x62a, 0x62c, 0x627, 0x647) + ')';
  var EASTERN_DIGITS = cp(0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667, 0x668, 0x669);
  var NON_TEXT_MIN = 3; // WCAG 1.4.11: focus rings and control borders
  function textMin(id) {
    return id.project.contrast === 'AAA' ? 7 : 4.5;
  }

  var TYPE_LABEL = { landing: 'landing page', website: 'website', 'web-app': 'web application', dashboard: 'dashboard', 'html-page': 'single HTML page' };
  var LANGUAGE_LABEL = { ar: 'Arabic', en: 'English', 'ar+en': 'Arabic and English' };
  var DIRECTION_LABEL = { rtl: 'right-to-left', ltr: 'left-to-right', both: 'both directions (Arabic pages right-to-left, English pages left-to-right)' };
  var ROLE_USE = {
    primary: 'Main action fill (one main action per screen), selected states.',
    onPrimary: 'Text and icons on primary.',
    secondary: 'Second accent: badges, secondary highlights.',
    onSecondary: 'Text and icons on secondary.',
    accentText: 'Links and accent-colored text on background and surface.',
    background: 'Page background.',
    surface: 'Cards, inputs, panels and secondary buttons.',
    onSurface: 'Body text and headings.',
    mutedText: 'Captions, helper text, metadata.',
    border: 'Dividers and decorative borders (not for control boundaries).',
    success: 'Success state: icons, borders, fills.',
    warning: 'Warning state: icons, borders, fills.',
    danger: 'Error and destructive state: icons, borders, fills.',
    info: 'Information state: icons, borders, fills.'
  };
  var MOTION_TEXT = {
    none: 'No animation. State changes (hover, open, close, page changes) are instant; never animate movement.',
    subtle: 'Short fades and color changes only: 120-180ms, ease-out. Movement at most 4px. Nothing loops.',
    medium: 'Fades plus small movement: 180-250ms, ease-out for entering, ease-in for leaving. Movement at most 8px.',
    strong: 'Expressive entrances and transitions: 250-400ms with ease-in-out. Larger movement and scale are allowed for key moments, never for every element.'
  };
  var CONTAINER_TEXT = {
    none: 'no container (the icon alone)',
    circle: 'a circular container',
    square: 'a square container with sharp corners',
    rounded: 'a square container with the md corner radius'
  };

  function c() {
    var d = deps();
    if (!d.contrast) fail('load contrast.js before generate.js to build the export files');
    return d.contrast;
  }

  // First candidate that reaches `min` against both background and surface; else the best of them.
  function pickNonText(set, candidates) {
    var ct = c();
    var best = null;
    var bestMin = -1;
    for (var i = 0; i < candidates.length; i++) {
      var hex = candidates[i];
      var m = Math.min(ct.ratio(hex, set.background), ct.ratio(hex, set.surface));
      if (m >= NON_TEXT_MIN) return hex;
      if (m > bestMin) {
        best = hex;
        bestMin = m;
      }
    }
    return best;
  }

  // Focus ring: primary when it reaches 3:1, else accent text (an AA text color always does). Control borders
  // (inputs, secondary buttons): border when it reaches 3:1, else muted text.
  function uiColors(set) {
    return {
      focusRing: pickNonText(set, [set.primary, set.accentText, set.onSurface]),
      controlBorder: pickNonText(set, [set.border, set.mutedText, set.onSurface])
    };
  }

  // The family that draws the digits: Latin digits come from the first family of the stack (Latin first),
  // Eastern Arabic digits from the Arabic family.
  function numeralsFontName(id) {
    var ref = id.tokens.font.numerals;
    return id.extensions.numerals === 'arab' ? ref.arabic || ref.latin : ref.latin || ref.arabic;
  }

  function mainFontName(id, role) {
    var ref = id.tokens.font[role];
    return id.project.language === 'en' ? ref.latin || ref.arabic : ref.arabic || ref.latin;
  }

  function shown(a, b) {
    var ct = c();
    return a + ' on ' + b + ': ' + ct.display(ct.ratio(a, b)) + ':1';
  }

  function pct(x) {
    return Math.round(x * 10000) / 100 + '%';
  }

  function belowMark(a, b, min) {
    var r = c().ratio(a, b);
    if (r >= min) return '';
    if (min === NON_TEXT_MIN || r < 3) return ' (below ' + (min === NON_TEXT_MIN ? NON_TEXT_MIN : 3) + ':1: do not use)';
    return ' (below the ' + min + ':1 target: large text only)';
  }

  function list(items) {
    return items
      .map(function (x) {
        return '`' + x + '`';
      })
      .join(', ');
  }

  function fullDesignMd(identity) {
    var schema = checkIdentity(identity);
    var id = canonical(schema, schema, identity);
    var t = id.tokens;
    var ext = id.extensions;
    var ui = { light: uiColors(t.color.light), dark: uiColors(t.color.dark) };
    var names = sizeNames(t.typeScale);
    var lh = mainLineHeight(id);
    var hasBelow = names.indexOf('sm') !== -1;
    var TEXT_MIN = textMin(id);

    /* ----- front matter ----- */
    var y = ['---', 'version: alpha', 'name: ' + q(id.name)];
    y.push('description: ' + q('Design identity for a ' + TYPE_LABEL[id.project.type] + ' (' + LANGUAGE_LABEL[id.project.language] + ', ' + id.project.direction + '), generated by Hawiya.'));
    y.push('colors:');
    [['light', ''], ['dark', 'dark-']].forEach(function (m) {
      ROLES.forEach(function (role) {
        y.push('  ' + m[1] + kebab(role) + ': ' + q(t.color[m[0]][role]));
      });
      y.push('  ' + m[1] + 'focus-ring: ' + q(ui[m[0]].focusRing));
      y.push('  ' + m[1] + 'control-border: ' + q(ui[m[0]].controlBorder));
    });
    y.push('typography:');
    function typo(name, role, px, weight, extra) {
      y.push('  ' + name + ':');
      y.push('    fontFamily: ' + q(role === 'numerals' ? numeralsFontName(id) : mainFontName(id, role)));
      y.push('    fontSize: ' + q(px + 'px'));
      y.push('    fontWeight: ' + weight);
      y.push('    lineHeight: ' + q(String(lh))); // quoted: the pinned tool drops a bare number when reading it back
      if (extra) y.push('    fontFeature: ' + q(extra));
    }
    for (var i = t.typeScale.steps.length - 1; i >= 0; i--) {
      var nm = names[i];
      var px = t.typeScale.steps[i];
      if (nm === 'base') {
        typo('body-md', 'body', px, 400);
        typo('label-md', 'body', px, 600);
        typo('numeric-md', 'numerals', px, 400, '"tnum" 1');
      } else if (nm === 'sm' || /xs$/.test(nm)) {
        typo('body-' + nm, 'body', px, 400);
      } else {
        typo('headline-' + nm, 'heading', px, 700);
      }
    }
    y.push('rounded:');
    RADII.forEach(function (r) {
      y.push('  ' + r + ': ' + q(t.radius[r] + 'px'));
    });
    y.push('spacing:');
    y.push('  unit: ' + q(t.spacing.unit + 'px'));
    t.spacing.scale.forEach(function (sp, k) {
      y.push('  space-' + k + ': ' + q(sp + 'px'));
    });
    y.push('components:');
    function comp(name, props) {
      y.push('  ' + name + ':');
      props.forEach(function (pp) {
        y.push('    ' + pp[0] + ': ' + q(pp[1]));
      });
    }
    var smallText = hasBelow ? '{typography.body-sm}' : '{typography.body-md}';
    [['', ''], ['-dark', 'dark-']].forEach(function (m) {
      var col = function (n) {
        return '{colors.' + m[1] + n + '}';
      };
      comp('page' + m[0], [['backgroundColor', col('background')], ['textColor', col('on-surface')], ['typography', '{typography.body-md}']]);
      comp('button-primary' + m[0], [['backgroundColor', col('primary')], ['textColor', col('on-primary')], ['typography', '{typography.label-md}'], ['rounded', '{rounded.md}']]);
      comp('button-secondary' + m[0], [['backgroundColor', col('surface')], ['textColor', col('accent-text')], ['typography', '{typography.label-md}'], ['rounded', '{rounded.md}']]);
      comp('badge-secondary' + m[0], [['backgroundColor', col('secondary')], ['textColor', col('on-secondary')], ['typography', '{typography.label-md}'], ['rounded', '{rounded.full}']]);
      comp('card' + m[0], [['backgroundColor', col('surface')], ['textColor', col('on-surface')], ['rounded', '{rounded.lg}']]);
      comp('caption' + m[0], [['backgroundColor', col('surface')], ['textColor', col('muted-text')], ['typography', smallText]]);
      comp('link' + m[0], [['backgroundColor', col('background')], ['textColor', col('accent-text')], ['typography', '{typography.body-md}']]);
      comp('input-field' + m[0], [['backgroundColor', col('surface')], ['textColor', col('on-surface')], ['typography', '{typography.body-md}'], ['rounded', '{rounded.md}']]);
      comp('control-outline' + m[0], [['backgroundColor', col('control-border')], ['width', '1px']]);
      comp('focus-ring' + m[0], [['backgroundColor', col('focus-ring')], ['width', '2px']]);
      comp('divider' + m[0], [['backgroundColor', col('border')], ['height', '1px']]);
      ['success', 'warning', 'danger', 'info'].forEach(function (st) {
        comp('status-' + st + m[0], [['backgroundColor', col(st)], ['size', '8px']]);
      });
    });
    y.push('---');

    /* ----- prose ----- */
    var title = proseName(id.name).replace(/[~&$@]/g, ' ').replace(/:\/\//g, ' ').replace(/\bwww\./gi, 'www ').replace(/\s+/g, ' ').trim() || 'Hawiya identity';
    var b = ['# ' + title, ''];

    b.push('## Overview', '');
    b.push(
      'A design identity for a ' + TYPE_LABEL[id.project.type] + ' in ' + LANGUAGE_LABEL[id.project.language] + ', written ' +
        DIRECTION_LABEL[id.project.direction] + '. The tokens above are normative; `tokens.css`, `theme.css` (Tailwind v4) and `tokens.json` next to this file carry the same values for code. Where this file is silent, stay plain and consistent rather than decorative.'
    );
    b.push('');
    b.push('- Platform: web. Contrast target: WCAG ' + id.project.contrast + ' (' + (id.project.contrast === 'AAA' ? '7:1' : '4.5:1') + ' for body text).');
    b.push('- Button style: `' + ext.components.button + '`. Card style: `' + ext.components.card + '`.');
    if (id.autoFilled.length) b.push('- Filled in automatically (refine freely, keep the tokens): ' + list(id.autoFilled) + '.');
    if (id.leaveToAI.length) b.push('- Left to your judgment, within these tokens: ' + list(id.leaveToAI) + '.');
    b.push('');

    b.push('## Colors', '');
    b.push('Two modes share the same roles. In the tokens above the light value has the plain name (`primary`) and the dark value a `dark-` prefix (`dark-primary`). In code both live under one variable (`--color-primary` in tokens.css, `bg-primary` in Tailwind) that switches with the mode.');
    b.push('');
    b.push('| Role | Light | Dark | Use |', '|---|---|---|---|');
    ROLES.forEach(function (role) {
      b.push('| `' + kebab(role) + '` | ' + t.color.light[role] + ' | ' + t.color.dark[role] + ' | ' + ROLE_USE[role] + ' |');
    });
    b.push('| `focus-ring` | ' + ui.light.focusRing + ' | ' + ui.dark.focusRing + ' | Keyboard focus outline. |');
    b.push('| `control-border` | ' + ui.light.controlBorder + ' | ' + ui.dark.controlBorder + ' | Boundaries of inputs and secondary buttons. |');
    b.push('');
    b.push('Measured contrast (WCAG 2). The ' + id.project.contrast + ' target is ' + TEXT_MIN + ':1 for body text' + (TEXT_MIN === 7 ? ' and 4.5:1 for large text (24px, or 18.66px bold)' : ' and 3:1 for large text') + '; focus rings and control borders need ' + NON_TEXT_MIN + ':1. A pair below the body-text target is marked and may carry large text only:');
    b.push('');
    ['light', 'dark'].forEach(function (mode) {
      var s = t.color[mode];
      var pairs = [
        ['Text on primary', s.onPrimary, s.primary, TEXT_MIN],
        ['Text on secondary', s.onSecondary, s.secondary, TEXT_MIN],
        ['Body text on background', s.onSurface, s.background, TEXT_MIN],
        ['Body text on surface', s.onSurface, s.surface, TEXT_MIN],
        ['Muted text on surface', s.mutedText, s.surface, TEXT_MIN],
        ['Accent text on background', s.accentText, s.background, TEXT_MIN],
        ['Focus ring on background', ui[mode].focusRing, s.background, NON_TEXT_MIN],
        ['Control border on background', ui[mode].controlBorder, s.background, NON_TEXT_MIN]
      ];
      b.push('- **' + (mode === 'light' ? 'Light' : 'Dark') + ':** ' + pairs.map(function (pr) {
        return pr[0] + ' `' + shown(pr[1], pr[2]) + '`' + belowMark(pr[1], pr[2], pr[3]);
      }).join('; ') + '.');
    });
    b.push('');
    b.push('Status colors (success, warning, danger, info) are for icons, borders and fills. Use one as text only where it reaches ' + TEXT_MIN + ':1 against both background and surface (shown: against the background):');
    b.push('');
    ['light', 'dark'].forEach(function (mode) {
      var s = t.color[mode];
      var ct = c();
      b.push('- **' + (mode === 'light' ? 'Light' : 'Dark') + ':** ' + ['success', 'warning', 'danger', 'info'].map(function (st) {
        var ok = Math.min(ct.ratio(s[st], s.background), ct.ratio(s[st], s.surface)) >= TEXT_MIN;
        return st + ' `' + shown(s[st], s.background) + '` (' + (ok ? 'text allowed' : 'not for text') + ')';
      }).join('; ') + '.');
    });
    b.push('');
    b.push('Focus ring: `--color-focus-ring` (Tailwind `outline-focus-ring`), the primary color when it reaches ' + NON_TEXT_MIN + ':1 against background and surface, otherwise a role with more contrast (accent text, then body text). Control boundaries: `--color-control-border` (Tailwind `border-control-border`), never the lighter decorative `border`. Both switch with the mode like every other color.');
    var weakUi = [];
    ['light', 'dark'].forEach(function (mode) {
      var s = t.color[mode];
      ['focusRing', 'controlBorder'].forEach(function (k) {
        if (Math.min(c().ratio(ui[mode][k], s.background), c().ratio(ui[mode][k], s.surface)) < NON_TEXT_MIN) weakUi.push(mode + ' ' + (k === 'focusRing' ? 'focus ring' : 'control border'));
      });
    });
    if (weakUi.length) b.push('', '**Warning:** no color of this identity reaches ' + NON_TEXT_MIN + ':1 for: ' + weakUi.join(', ') + '. Adjust the colors before building.');
    var weakText = [];
    ['light', 'dark'].forEach(function (mode) {
      var s = t.color[mode];
      [['text on primary', s.onPrimary, s.primary], ['text on secondary', s.onSecondary, s.secondary], ['body text on background', s.onSurface, s.background],
        ['body text on surface', s.onSurface, s.surface], ['muted text on surface', s.mutedText, s.surface], ['accent text on background', s.accentText, s.background]].forEach(function (pr) {
        if (c().ratio(pr[1], pr[2]) < TEXT_MIN) weakText.push(mode + ' ' + pr[0]);
      });
    });
    if (weakText.length) {
      b.push('', '**Warning:** this identity does not meet the ' + id.project.contrast + ' target (' + TEXT_MIN + ':1) for: ' + weakText.join(', ') + '. The components above still use these pairs at normal text size, so the result meets ' + (TEXT_MIN === 7 ? 'AA, not AAA' : 'neither target') + '. Adjust the colors (or choose AA) before building.');
    }
    b.push('');
    b.push('Eleven-step ramps for tints and shades, the same in both modes (50 lightest, 950 darkest; `--color-primary-50` ... `--color-primary-950` in tokens.css):');
    b.push('');
    RAMPS.forEach(function (r) {
      b.push('- **' + r + ':** ' + t.color.ramps[r].join(', ') + '.');
    });
    b.push('');

    b.push('## Typography', '');
    FONT_ROLES.forEach(function (role) {
      var ref = t.font[role];
      var parts = [];
      if (ref.arabic) parts.push('Arabic **' + ref.arabic + '**');
      if (ref.latin) parts.push('Latin **' + ref.latin + '**');
      var line = '- **' + role.charAt(0).toUpperCase() + role.slice(1) + ':** ' + parts.join(', ') + ', then `' + ref.fallback.join(', ') + '`.';
      if (ref.arabic && ref.latin && hasOwn(ref, 'latinSizeAdjust')) {
        line += ' Latin size adjustment: **' + ref.latinSizeAdjust + '** (the Latin family drawn at ' + pct(ref.latinSizeAdjust) + ' so it looks the same size as the Arabic one).';
      }
      b.push(line);
    });
    b.push('');
    var adjusted = FONT_ROLES.filter(function (role) {
      var ref = t.font[role];
      return ref.arabic && ref.latin && hasOwn(ref, 'latinSizeAdjust');
    });
    if (adjusted.length) {
      b.push('');
      b.push('Apply a Latin size adjustment to the font itself, not to elements: add the `size-adjust` descriptor to the `@font-face` rules of the Latin family (for example `size-adjust: ' + pct(t.font[adjusted[0]].latinSizeAdjust) + ';` when self-hosting the font or copying the Google Fonts `@font-face` rules). It scales only that family\'s letters wherever they appear, so it needs no extra markup and never compounds. If two roles use the same Latin family with different values, give each its own `@font-face` family name.');
    }
    b.push('');
    b.push('Load the fonts from Google Fonts. Font stacks for code: `--font-heading`, `--font-body` and `--font-numerals` in tokens.css (Latin family first, so Latin text uses it and Arabic letters fall through to the Arabic family).');
    b.push('');
    b.push('Line height: ' + t.font.lineHeight.ar + ' for Arabic text and ' + t.font.lineHeight.en + ' for Latin text (`--line-height-ar`, `--line-height-en`). Arabic needs the extra height for its marks and descenders.');
    b.push('');
    b.push('Type scale (base ' + t.typeScale.base + 'px, ratio ' + t.typeScale.ratio + '): ' + t.typeScale.steps.map(function (sp, k) {
      return names[k] + ' ' + sp + 'px';
    }).join(', ') + '. Headings use weight 700, labels 600, body 400. Use only these sizes.');
    b.push('');

    b.push('## Layout', '');
    b.push('Spacing comes from a ' + t.spacing.unit + 'px unit. Allowed steps, with the tokens.css variable and the Tailwind multiplier: ' + t.spacing.scale.map(function (sp, k) {
      var mult = sp / t.spacing.unit;
      return sp + 'px (`--space-' + k + '`' + (Math.floor(mult) === mult ? ', `p-' + mult + '`' : '') + ')';
    }).join(', ') + '. Use no other gaps: in Tailwind the number is a multiple of the unit, not the step index.');
    b.push('');
    b.push('Lay out with logical properties only (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `text-align: start`), so the same CSS works in both directions. Group related content in cards; keep the reading column comfortable (about 60-75 characters of Latin text).');
    b.push('');

    b.push('## Elevation & Depth', '');
    b.push('Shadows per mode (CSS `box-shadow` values; `--shadow-sm|md|lg` in tokens.css). Dark values apply when the system prefers dark unless the page sets `<html data-theme="light">`, and always with `<html data-theme="dark">`.');
    b.push('');
    ['light', 'dark'].forEach(function (mode) {
      b.push('- **' + (mode === 'light' ? 'Light' : 'Dark') + ':** ' + SIZES.map(function (sz) {
        var layers = t.shadow[mode][sz];
        return sz + ' ' + (layers.length ? '`' + cssShadow(layers) + '`' : 'no shadow');
      }).join('; ') + '.');
    });
    b.push('');
    b.push('Use sm for controls, md for cards and menus, lg for dialogs. Where a mode has no shadow, separate layers with surface color and borders instead.');
    b.push('');

    b.push('## Shapes', '');
    b.push('Corner radius: sm ' + t.radius.sm + 'px (small controls, tags), md ' + t.radius.md + 'px (buttons, inputs), lg ' + t.radius.lg + 'px (cards, dialogs), full for pills and avatars. An element is never rounder than the container around it.');
    b.push('');

    b.push('## Components', '');
    b.push('Every component has a `-dark` twin in the tokens above with the dark colors.');
    b.push('');
    b.push('- **Primary button:** primary fill, on-primary text, label-md, rounded md. One per screen.');
    b.push('- **Secondary button:** surface fill, accent-text text, 1px control-border outline, rounded md.');
    b.push('- **Card:** surface fill, on-surface text, rounded lg, 1px border or the md shadow.');
    b.push('- **Input field:** surface fill, on-surface text, 1px control-border outline, rounded md; muted-text for helper text and placeholders.');
    b.push('- **Badge:** secondary fill, on-secondary text, rounded full.');
    b.push('- **Link:** accent-text, underlined.');
    b.push('- **Focus:** every interactive element shows a 2px focus-ring outline with a 2px offset on keyboard focus (`:focus-visible`).');
    b.push('- **Status:** a status color as an icon, border or 8px dot next to the message; the message text stays on-surface.');
    b.push('');

    b.push("## Do's and Don'ts", '');
    b.push('- Do use the primary color for the single main action on each screen.');
    b.push('- Do keep body text at ' + TEXT_MIN + ':1 or more (WCAG ' + id.project.contrast + '), and focus rings and control borders at ' + NON_TEXT_MIN + ':1 or more.');
    b.push('- Do use only the colors, sizes, radii, shadows and spacing steps defined here; if Tailwind is used, ignore its default palette and scales.');
    b.push('- Do use CSS logical properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`), never `left` / `right`.');
    b.push("- Don't add letter-spacing, uppercase or italic to Arabic text.");
    b.push("- Don't add fonts, colors or icon sets that are not listed here.");
    b.push('');

    b.push('## Iconography', '');
    b.push('Use the **' + ext.icons.library + '** icon set only, weight **' + ext.icons.weight + '**, **' + ext.icons.fill + '** style, with **' + ext.icons.container + '** container (' + CONTAINER_TEXT[ext.icons.container] + '). Size icons with the text (1em to 1.25em) and color them with `currentColor`. Mirroring rules are in the Arabic & Direction section.');
    b.push('');

    b.push('## Motion', '');
    b.push('Motion level: **' + ext.motion + '**. ' + MOTION_TEXT[ext.motion]);
    b.push('');
    b.push('Always honor `prefers-reduced-motion: reduce`: then nothing moves (instant changes or plain fades under 100ms).');
    b.push('');

    var arNu = ext.numerals === 'arab' ? 'arab' : 'latn';
    var calStr = '-u-ca-' + ext.calendar;
    b.push('## Numbers & Calendar', '');
    if (ext.numerals === 'arab') {
      b.push('Digits: **Eastern Arabic** (' + EASTERN_DIGITS + ') in Arabic text, Western digits (0123456789) in English text. Format numbers with `new Intl.NumberFormat("ar-u-nu-arab")` in Arabic text and `new Intl.NumberFormat("en-u-nu-latn")` in English text.');
    } else {
      b.push('Digits: **Western** (0123456789), also in Arabic text. Format numbers with `new Intl.NumberFormat("ar-u-nu-latn")` in Arabic text and `new Intl.NumberFormat("en-u-nu-latn")` in English text.');
    }
    var digits = t.font.numerals.easternArabicDigits;
    b.push('');
    var digitsNote = '';
    if (ext.numerals === 'arab') {
      digitsNote = digits === true ? 'It draws Eastern Arabic digits.' : digits === false ? 'It does not draw Eastern Arabic digits; they fall back to the next font in the stack.' : 'Whether it draws Eastern Arabic digits was not tested.';
    }
    b.push('Numbers font: ' + numeralsFontName(id) + ' draws the digits (`--font-numerals`). ' + digitsNote + (digitsNote ? ' ' : '') + 'In tables and figures that must line up, use `font-variant-numeric: tabular-nums` (the numeric-md token).');
    b.push('');
    b.push('Calendar: **' + (ext.calendar === 'islamic-umalqura' ? 'Hijri (Umm al-Qura)' : 'Gregorian') + '**. Format dates with `new Intl.DateTimeFormat("ar' + calStr + '-nu-' + arNu + '")` in Arabic text and `new Intl.DateTimeFormat("en' + calStr + '-nu-latn")` in English text.');
    b.push('');

    b.push('## ' + AR_SECTION, '');
    if (id.project.language === 'ar') b.push('- Pages: `<html lang="ar" dir="rtl">`.');
    else if (id.project.language === 'en') b.push('- Pages: `<html lang="en" dir="ltr">`; Arabic passages inside get `lang="ar" dir="rtl"`.');
    else b.push('- Arabic pages: `<html lang="ar" dir="rtl">`; English pages: `<html lang="en" dir="ltr">`. A passage in the other language gets its own `lang` and `dir`.');
    b.push('- Use logical properties only: `margin-inline-start` / `margin-inline-end`, `padding-inline-*`, `inset-inline-start` / `inset-inline-end`, `border-inline-*`, `text-align: start` / `end`. Never physical left / right values.');
    b.push('- Mirror in right-to-left: ' + list(ext.rtl.mirror) + ' (for example `.icon-' + ext.rtl.mirror[0] + ':dir(rtl) { scale: -1 1; }`: `:dir()` follows the nearest `dir`, so icons inside a left-to-right passage stay as they are, and the `scale` property keeps any other transform).');
    b.push('- Never mirror: ' + list(ext.rtl.neverMirror) + '.');
    b.push('- Arabic text: line height ' + t.font.lineHeight.ar + '; no letter-spacing, uppercase or italic; never break or justify words letter by letter.');
    b.push('- Latin snippets inside Arabic text (emails, URLs, code, product names) go in `<bdi>` or an element with `dir="ltr"` (add `lang="en"` for English words), so their order stays correct.');
    b.push('');

    return y.join('\n') + '\n\n' + b.join('\n').replace(/\n+$/, '') + '\n';
  }

  generate.designMd = fullDesignMd;
  generate.uiColors = uiColors;

  generate.valueFiles = valueFiles;
  generate.sizeNames = sizeNames;

  return generate;
});
