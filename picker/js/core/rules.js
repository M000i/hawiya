/*
 * Blocking rules (task 2.14, R-026): choices that can never be applied, each with a reason, and for contrast the
 * nearest color that passes. Browser: window.Hawiya.rules (load color.js, contrast.js, ramp.js and modes.js
 * first). Node: require.
 *
 * The four rules:
 *   font-language       the fonts support the project language: Arabic projects need an Arabic font, English
 *                       projects a Latin one, bilingual projects both (template extras.languages and the
 *                       identity's heading and body roles). Eastern Arabic numerals need a numerals font that
 *                       draws them (easternArabicDigits recorded true; rule "font-numerals").
 *   contrast            every text color reaches the project's level (AA 4.5:1, AAA 7:1) on the background and
 *                       the surface, and button text on its fill, in light AND dark mode.
 *   arabic-typography   no letter-spacing, no uppercase / capitalized / small-caps text and no italic or slant
 *                       when the project has Arabic text (ar or ar+en): in a template's tokens, its recipe CSS
 *                       (custom properties followed), inline styles and italic tags (i, em, ...) in its HTML.
 *   platform            a template made for other platforms does not appear in this project's platform.
 *
 *   contrast(text, background, level [, large]) → { allowed, ratio, shown, required, suggestion }
 *     ratio is exact (the verdict uses it); shown is the display value (contrast.display). When blocked,
 *     suggestion is the step of the text color's own ramp nearest to it (in OKLCH lightness) that passes, or null.
 *   template(tpl, project) → [problem]     project = identity.project ({ language, platform, contrast, ... });
 *                                          a palette (colors template) is also checked at project.contrast
 *   allowed(tpl, project)  → boolean        no problem: what a gallery may offer and "fill the rest" may pick
 *   identity(identity, find) → { allowed, problems, suggestion, unchecked }
 *     find(element, id) returns a template (the library); elements whose template it cannot find are listed in
 *     unchecked (their data is not loaded yet) and are not counted as allowed or blocked. suggestion, when the
 *     contrast rule blocks: { element: 'colors', overrides: { primary?, secondary? } }, the nearest steps of
 *     those colors' own ramps with which every color pair passes (only the colors that change), or null.
 *
 * A problem is { rule, element, template?, ... } with plain data only (the page words it in both languages).
 *
 * Warning rules (task 2.15, R-027 / R-091): the page shows them and the user may go on.
 *   warnings(identity, find) → { warnings: [{ rule, element, ... }], unchecked: [element] }
 *   thin-icons-heavy-font    icons of weight thin or light with a font whose weight (fonts extras.weight, the
 *                            font's regular weight) is 600 or more
 *   button-radius-over-card  the button recipe's corners are rounder than the card recipe's (identity radii)
 *   dark-shadows-vanish      a shadow level that shows in light mode (changes the light background by 0.02
 *                            OKLCH lightness or more) changes the dark background by less (or has no dark layer)
 *   arabic-line-height       Arabic line height below 1.6 in a project with Arabic text
 *   display-font-body        the font is a display font (fonts extras.display true) and so is used for body text
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var H = node ? null : root.Hawiya || {};
  var color = node ? require('./color.js') : H.color;
  var contrast = node ? require('./contrast.js') : H.contrast;
  var ramp = node ? require('./ramp.js') : H.ramp;
  var modes = node ? require('./modes.js') : H.modes;
  if (!color || !contrast || !ramp || !modes) {
    throw new Error('Hawiya.rules: load color.js, contrast.js, ramp.js and modes.js first');
  }
  var api = factory(color, contrast, ramp, modes);
  if (node) module.exports = api;
  else root.Hawiya.rules = api;
})(typeof self !== 'undefined' ? self : this, function (color, contrast, ramp, modes) {
  'use strict';

  var REQUIRED = { normal: { AA: 4.5, AAA: 7 }, large: { AA: 3, AAA: 4.5 } };
  var NEEDS = { ar: ['ar'], en: ['en'], 'ar+en': ['ar', 'en'] };
  // Text roles must be readable on both page colors; button text on its own fill.
  var TEXT = ['onSurface', 'mutedText', 'accentText', 'success', 'warning', 'danger', 'info'];
  var PAGE = ['background', 'surface'];
  var FILLS = [
    ['onPrimary', 'primary'],
    ['onSecondary', 'secondary']
  ];

  function own(o, k) {
    return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  }

  function level(l) {
    if (l !== 'AA' && l !== 'AAA') throw new Error('Hawiya.rules: level must be "AA" or "AAA"');
    return l;
  }

  /* ---------- contrast ---------- */

  // Steps of a ramp, nearest to its input first (OKLCH lightness; on a tie the darker step first).
  function nearestSteps(hex) {
    var r = ramp.generate(hex);
    var L0 = color.toOklch(color.normalizeHex(hex)).L;
    return r.steps
      .map(function (s, i) {
        return { hex: s, i: i, d: Math.abs(color.toOklch(s).L - L0) };
      })
      .filter(function (x) {
        return x.i !== r.anchor;
      })
      .sort(function (a, b) {
        return a.d - b.d || b.i - a.i;
      })
      .map(function (x) {
        return x.hex;
      });
  }

  function checkContrast(text, background, lvl, large) {
    var required = REQUIRED[large ? 'large' : 'normal'][level(lvl)];
    var exact = contrast.ratio(text, background);
    var out = {
      allowed: exact >= required,
      ratio: exact,
      shown: contrast.display(exact),
      required: required,
      suggestion: null
    };
    if (!out.allowed) {
      var steps = nearestSteps(text);
      for (var i = 0; i < steps.length; i++) {
        if (contrast.ratio(steps[i], background) >= required) {
          out.suggestion = steps[i];
          break;
        }
      }
    }
    return out;
  }

  // Every text pair of a color set (identity tokens.color or modes.derive output) below the level.
  function colorProblems(colors, lvl) {
    var required = REQUIRED.normal[level(lvl)];
    var out = [];
    ['light', 'dark'].forEach(function (mode) {
      var set = colors[mode];
      var pairs = [];
      TEXT.forEach(function (t) {
        PAGE.forEach(function (p) {
          pairs.push([t, p]);
        });
      });
      FILLS.forEach(function (f) {
        pairs.push(f);
      });
      pairs.forEach(function (pair) {
        var exact = contrast.ratio(set[pair[0]], set[pair[1]]);
        if (exact < required) {
          out.push({
            rule: 'contrast',
            element: 'colors',
            mode: mode,
            text: pair[0],
            on: pair[1],
            ratio: exact,
            shown: contrast.display(exact),
            required: required
          });
        }
      });
    });
    return out;
  }

  /* ---------- template rules ---------- */

  var ZERO = /^(normal|[+-]?0*\.?0+([a-z]+|%)?|inherit|initial|unset|revert|revert-layer)$/;

  function spacingValue(v) {
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      var calc = /^calc\((.*)\)$/.exec(s);
      return !ZERO.test(calc ? calc[1].trim() : s);
    }
    if (own(v, 'value')) return Number(v.value) !== 0;
    return true; // anything else cannot be shown to be zero
  }

  // Quoted font family names ("Oblique Sans") are names, not styles.
  function unquoted(v) {
    return typeof v === 'string' ? v.replace(/"[^"]*"|'[^']*'/g, '') : v;
  }

  function caps(v) {
    return typeof v === 'string' && /uppercase|capitalize|small-caps|petite-caps|unicase|titling-caps/i.test(v);
  }

  function italic(v) {
    return typeof v === 'string' && /italic|oblique/i.test(unquoted(v));
  }

  // font-variation-settings that slant or italicize: 'slnt' not 0, 'ital' not 0.
  function slanted(v) {
    var re = /["'](slnt|ital)["']\s*([+-]?[\d.]+)/gi;
    var m;
    while ((m = re.exec(v))) if (Number(m[2]) !== 0) return true;
    return false;
  }

  // Elements that browsers draw in italic by default.
  var ITALIC_TAGS = /<(i|em|cite|var|dfn|address)[\s>/]/i;

  // Letter-spacing, uppercase and italic set by a template, in its tokens or its recipe CSS.
  function latinOnlyStyles(tpl) {
    var found = [];
    function add(property, where) {
      for (var i = 0; i < found.length; i++) {
        if (found[i].property === property && found[i].where === where) return;
      }
      found.push({ property: property, where: where });
    }
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      Object.keys(node).forEach(function (k) {
        var name = k.toLowerCase().replace(/[-_]/g, '');
        var v = node[k];
        var value = own(v, '$value') ? v.$value : v;
        if (name === 'letterspacing' && spacingValue(value)) add('letter-spacing', 'tokens');
        else if (name === 'texttransform' && caps(value)) add('text-transform', 'tokens');
        else if (name === 'fontstyle' && italic(value)) add('font-style', 'tokens');
        else walk(v);
      });
    })(tpl.tokens);
    var recipe = tpl.recipe || {};
    var html = typeof recipe.html === 'string' ? recipe.html : '';
    if (ITALIC_TAGS.test(html)) add('font-style', 'recipe');
    // The recipe's CSS, plus any inline style="..." in its HTML.
    var css = typeof recipe.css === 'string' ? recipe.css : '';
    var inline = /\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
    var s;
    while ((s = inline.exec(html))) css += ';' + (s[2] !== undefined ? s[2] : s[3] !== undefined ? s[3] : s[4]);
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\/g, '');
    var decl = /(?:^|[;{\s])(-?-?[a-z][a-z0-9-]*)\s*:\s*([^;{}]*)/gi;
    var list = [];
    var custom = {};
    var m;
    while ((m = decl.exec(css))) {
      var prop = m[1].toLowerCase();
      var val = m[2].replace(/!important/i, '').trim();
      if (prop.indexOf('--') === 0) custom[prop] = (custom[prop] || []).concat(val);
      else list.push([prop, val]);
    }
    // A value taken from a custom property counts with every value that property is given; one never given
    // cannot be shown to be harmless.
    // Custom properties that refer to others are followed (a few levels; deeper counts as unknown).
    function values(val, depth) {
      var refs = val.match(/var\(\s*--[a-z0-9-]+/gi);
      if (!refs) return [val];
      if ((depth || 0) > 8) return [null];
      var out = [];
      refs.forEach(function (r) {
        var name = r.replace(/var\(\s*/i, '').toLowerCase();
        (custom[name] || [null]).forEach(function (v) {
          out = out.concat(v === null ? [null] : values(v, (depth || 0) + 1));
        });
      });
      return out;
    }
    list.forEach(function (d) {
      var prop = d[0];
      values(d[1]).forEach(function (val) {
        var unknown = val === null;
        if (prop === 'letter-spacing' && (unknown || spacingValue(val))) add('letter-spacing', 'recipe');
        else if (/^(text-transform|font-variant|font-variant-caps)$/.test(prop) && (unknown || caps(val))) {
          add('text-transform', 'recipe');
        } else if (prop === 'font') {
          // The shorthand can set both small caps and italic.
          if (unknown || caps(unquoted(val))) add('text-transform', 'recipe');
          if (unknown || italic(val)) add('font-style', 'recipe');
        } else if (prop === 'font-style' && (unknown || italic(val))) {
          add('font-style', 'recipe');
        } else if (prop === 'font-variation-settings' && (unknown || slanted(val))) add('font-style', 'recipe');
      });
    });
    return found;
  }

  function hasArabic(language) {
    return language === 'ar' || language === 'ar+en';
  }

  function templateProblems(tpl, project, inIdentity) {
    var out = [];
    var base = { element: tpl.element, template: tpl.id };
    function problem(rule, extra) {
      var p = { rule: rule, element: base.element, template: base.template };
      Object.keys(extra || {}).forEach(function (k) {
        p[k] = extra[k];
      });
      out.push(p);
    }
    if (!Array.isArray(tpl.platforms) || tpl.platforms.indexOf(project.platform) === -1) {
      problem('platform', { platform: project.platform });
    }
    if (tpl.element === 'fonts') {
      var has = tpl.extras && Array.isArray(tpl.extras.languages) ? tpl.extras.languages : [];
      var missing = (NEEDS[project.language] || ['ar', 'en']).filter(function (l) {
        return has.indexOf(l) === -1;
      });
      if (missing.length) problem('font-language', { language: project.language, missing: missing });
    }
    // A palette is offered only when its colors reach the project's contrast level (both modes). In a whole
    // identity the colors actually used (after any adjustment) are checked instead (identityProblems).
    if (tpl.element === 'colors' && project.contrast && !inIdentity) {
      var c = tpl.tokens && tpl.tokens.color;
      var hex = function (k) {
        return c && c[k] && c[k].$value && typeof c[k].$value.hex === 'string' ? c[k].$value.hex : null;
      };
      if (hex('primary')) {
        failing(hex('primary'), hex('secondary'), project.contrast).forEach(function (p) {
          problem('contrast', {
            mode: p.mode,
            text: p.text,
            on: p.on,
            ratio: p.ratio,
            shown: p.shown,
            required: p.required
          });
        });
      }
    }
    if (hasArabic(project.language)) {
      latinOnlyStyles(tpl).forEach(function (f) {
        problem('arabic-typography', { property: f.property, where: f.where });
      });
    }
    return out;
  }

  /* ---------- the whole identity ---------- */

  function fontProblems(identity) {
    var out = [];
    var font = identity.tokens.font;
    var language = identity.project.language;
    var key = { ar: 'arabic', en: 'latin' };
    ['heading', 'body'].forEach(function (role) {
      var missing = (NEEDS[language] || ['ar', 'en']).filter(function (l) {
        return !own(font[role], key[l]);
      });
      if (missing.length) {
        out.push({ rule: 'font-language', element: 'fonts', role: role, language: language, missing: missing });
      }
    });
    // Eastern Arabic digits need a numerals font recorded (after a real test) to draw them.
    if (identity.extensions.numerals === 'arab' && font.numerals.easternArabicDigits !== true) {
      out.push({ rule: 'font-numerals', element: 'fonts', numerals: 'arab' });
    }
    return out;
  }

  // The colors the user chose: the primary, and the secondary when one was given (by an adjustment or by the
  // palette). Read from the identity itself, so it works even when the palette's data is not loaded: a
  // secondary is "given" unless it is exactly the one derivation would make from the primary.
  function chosenColors(identity) {
    var light = identity.tokens.color.light;
    var derived = modes.derive(light.primary, { level: identity.project.contrast }).light.secondary;
    var ov = (identity.selections.colors && identity.selections.colors.overrides) || {};
    var given = own(ov, 'secondary') || light.secondary !== derived;
    return { primary: light.primary, secondary: given ? light.secondary : null };
  }

  function failing(primary, secondary, lvl) {
    var opts = { level: lvl };
    if (secondary) opts.secondary = secondary;
    return colorProblems(modes.derive(primary, opts), lvl);
  }

  function onlySecondary(p) {
    return p.text === 'onSecondary';
  }

  /* The nearest primary whose problems (apart from the secondary's own button) are gone; then, if a secondary
     was given, the nearest secondary with which everything passes. Only the colors that change are suggested. */
  function contrastSuggestion(identity, find) {
    var lvl = identity.project.contrast;
    var c = chosenColors(identity);
    var primaries = [c.primary].concat(nearestSteps(c.primary));
    var primary = null;
    for (var i = 0; i < primaries.length && !primary; i++) {
      var left = failing(primaries[i], c.secondary, lvl);
      if (left.every(onlySecondary) && (c.secondary || !left.length)) primary = primaries[i];
    }
    if (!primary) return null;
    var secondary = c.secondary;
    if (c.secondary) {
      var secondaries = [c.secondary].concat(nearestSteps(c.secondary));
      secondary = null;
      for (var j = 0; j < secondaries.length && !secondary; j++) {
        if (!failing(primary, secondaries[j], lvl).length) secondary = secondaries[j];
      }
      if (!secondary) return null;
    }
    var overrides = {};
    if (primary !== c.primary) overrides.primary = primary;
    if (secondary !== c.secondary) overrides.secondary = secondary;
    return Object.keys(overrides).length ? { element: 'colors', overrides: overrides } : null;
  }

  function identityProblems(identity, find) {
    var problems = [];
    var unchecked = [];
    Object.keys(identity.selections)
      .sort()
      .forEach(function (element) {
        var tpl = find ? find(element, identity.selections[element].template) : null;
        if (!tpl) unchecked.push(element);
        else problems = problems.concat(templateProblems(tpl, identity.project, true));
      });
    problems = problems.concat(fontProblems(identity));
    var colors = colorProblems(identity.tokens.color, identity.project.contrast);
    problems = problems.concat(colors);
    return {
      allowed: problems.length === 0,
      problems: problems,
      suggestion: colors.length ? contrastSuggestion(identity, find) : null,
      unchecked: unchecked
    };
  }

  /* ---------- warnings (task 2.15, R-027 / R-091): shown, and the user may go on ---------- */

  var THIN_ICONS = ['thin', 'light'];
  var HEAVY = 600; // a font whose regular weight is this or more reads as heavy
  var MIN_AR_LINE = 1.6; // R-091: Arabic line height 1.6 .. 1.8 by default
  var SHADOW_SEEN = 0.02; // OKLCH lightness change a shadow must make on the dark background to be seen
  var RADIUS_VAR = /border-radius\s*:\s*var\(\s*--radius-(sm|md|lg|full)\s*\)|border-radius\s*:\s*(\d+(?:\.\d+)?)px/i;

  // The corner radius (px) a button or card recipe draws, from the identity's radii; null if it cannot be read.
  function recipeRadius(tpl, radius) {
    var css = tpl && tpl.recipe && typeof tpl.recipe.css === 'string' ? tpl.recipe.css : '';
    var m = RADIUS_VAR.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
    if (!m) return null;
    return m[1] ? radius[m[1].toLowerCase()] : Number(m[2]);
  }

  // How much a shadow layer changes the background it falls on (simple sRGB blend), in OKLCH lightness.
  function shadowChange(layer, background) {
    var bg = color.parseHex(background);
    var c = color.parseHex(layer.color);
    var a = layer.alpha;
    var mixed =
      '#' +
      bg
        .map(function (v, i) {
          var x = Math.round(v * (1 - a) + c[i] * a);
          return (x < 16 ? '0' : '') + x.toString(16);
        })
        .join('');
    return Math.abs(color.toOklch(mixed).L - color.toOklch(background).L);
  }

  function identityWarnings(identity, find) {
    var out = [];
    var unchecked = [];
    var sel = identity.selections;
    function tplOf(element) {
      var t = sel[element] && find ? find(element, sel[element].template) : null;
      if (sel[element] && !t) unchecked.push(element);
      return t;
    }
    var fonts = tplOf('fonts');
    var buttons = tplOf('buttons');
    var cards = tplOf('cards');
    var fx = (fonts && fonts.extras) || {};

    // 1. Thin icons next to a heavy font look faint.
    var iconWeight = identity.extensions.icons.weight;
    if (THIN_ICONS.indexOf(iconWeight) !== -1 && typeof fx.weight === 'number' && fx.weight >= HEAVY) {
      out.push({ rule: 'thin-icons-heavy-font', element: 'icons', icons: iconWeight, fontWeight: fx.weight });
    }

    // 2. Button corners rounder than the card's look out of place inside it.
    var b = recipeRadius(buttons, identity.tokens.radius);
    var c = recipeRadius(cards, identity.tokens.radius);
    if (typeof b === 'number' && typeof c === 'number' && b > c) {
      out.push({ rule: 'button-radius-over-card', element: 'radius', button: b, card: c });
    }

    // 3. Shadows that show in light mode but cannot be seen on the dark background.
    var sh = identity.tokens.shadow;
    var dbg = identity.tokens.color.dark.background;
    var lbg = identity.tokens.color.light.background;
    var visible = function (layers, bg) {
      return (layers || []).some(function (layer) {
        return shadowChange(layer, bg) >= SHADOW_SEEN;
      });
    };
    var levels = Object.keys(sh.light).filter(function (k) {
      if (!visible(sh.light[k], lbg)) return false; // no shadow to lose
      return !visible(sh.dark[k], dbg);
    });
    if (levels.length) out.push({ rule: 'dark-shadows-vanish', element: 'shadows', levels: levels });

    // 4. Arabic text needs room for its marks (R-091).
    var lh = identity.tokens.font.lineHeight.ar;
    if (hasArabic(identity.project.language) && lh < MIN_AR_LINE) {
      out.push({ rule: 'arabic-line-height', element: 'type-scale', lineHeight: lh, minimum: MIN_AR_LINE });
    }

    // 5. A display font is made for large headings, not for paragraphs.
    if (fx.display === true) out.push({ rule: 'display-font-body', element: 'fonts', template: fonts.id });

    return { warnings: out, unchecked: unchecked };
  }

  return {
    REQUIRED: REQUIRED,
    contrast: checkContrast,
    colors: colorProblems,
    template: templateProblems,
    allowed: function (tpl, project) {
      return templateProblems(tpl, project).length === 0;
    },
    identity: identityProblems,
    warnings: identityWarnings
  };
});
