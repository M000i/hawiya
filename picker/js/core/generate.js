/*
 * Prototype generator (task 0.3): turns the three prototype choices into
 * identity.json and DESIGN.md. Works in the browser (window.Hawiya.generate)
 * and in Node (module.exports). No dates or randomness: same input, same bytes.
 *
 * Input: { name, primary: "#rrggbb", fontFamily: string, radius: integer px 0..64 }
 * Output: { "identity.json": string, "DESIGN.md": string }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.generate = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
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

  return generate;
});
