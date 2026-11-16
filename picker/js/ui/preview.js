/*
 * Preview engine (task 2.6, R-028/R-029). Browser: window.Hawiya.preview.
 * Load generate.js, the scenes (picker/scenes/*.js) and the library data first.
 *
 *   preview.mount(hostElement)   creates the Shadow DOM (tool styles and scene styles never mix)
 *   preview.render(identity)     redraws the current scene with that identity (call on every change)
 *   preview.setLang('ar'|'en')   preview language (independent of the tool's interface language)
 *   preview.setMode('light'|'dark')
 *   preview.lang() / preview.mode() / preview.scene()
 *
 * The identity reaches the scene only as the CSS variables tokens.css would hold (generate.cssVariables), so
 * the preview shows what the exported files say. Button and card come from the chosen library recipes by id;
 * recipe placeholders ({label}, {title}, {body}) are filled as text, never parsed as HTML.
 * Until the user picks a preview language or mode, they follow the identity: its project language, and the
 * default mode of its "modes" template (system = the device's setting).
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});

  var BASE = [
    ':host { all: initial; display: block; }',
    '.scene { box-sizing: border-box; min-block-size: 100%; container-type: inline-size; font-family: var(--font-body); font-size: var(--sc-body);',
    '  line-height: var(--line-height); color: var(--color-on-surface); background: var(--color-background);',
    '  border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden;',
    // Rules the tool puts on the host element itself win over :host, so the scene resets what it would inherit.
    '  font-style: normal; font-weight: 400; letter-spacing: normal; word-spacing: normal; text-transform: none;',
    '  text-align: start; text-indent: 0; white-space: normal; visibility: visible; }',
    '.scene *, .scene *::before, .scene *::after { box-sizing: border-box; }',
    // Icons (task 2.12): sized to the text; meanings in the mirror list turn around in right-to-left text (R-093).
    '.hw-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; inline-size: 1.25em; block-size: 1.25em; vertical-align: -0.25em; }',
    '.hw-icon svg { inline-size: 100%; block-size: 100%; }',
    '.hw-icon--circle, .hw-icon--square, .hw-icon--rounded { inline-size: 2em; block-size: 2em; padding: 0.4em; background: var(--color-surface); border: 1px solid var(--color-border); }',
    '.hw-icon--circle { border-radius: 50%; }',
    '.hw-icon--rounded { border-radius: var(--radius-md); }',
    '[dir="rtl"] .hw-icon[data-mirror="true"] svg { transform: scaleX(-1); }',
    // Keyboard focus is always visible, in the identity's own focus-ring color (3:1 or more; task 2.22).
    '.scene :focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; }',
    // The page's own «reduce motion» rule does not reach inside this shadow root: the scene repeats it.
    '@media (prefers-reduced-motion: reduce) { .scene *, .scene *::before, .scene *::after { transition: none !important; animation: none !important; } }'
  ].join('\n');

  var host = null;
  var shadow = null;
  var identity = null;
  var sceneName = 'landing';
  var chosen = { lang: null, mode: null }; // null = follow the identity

  function template(element, id) {
    return H.library.find(element, id);
  }

  function autoLang(id) {
    return id && id.project.language === 'en' ? 'en' : 'ar';
  }

  function autoMode(id) {
    var m = id && template('modes', id.selections.modes && id.selections.modes.template);
    var d = m && m.tokens && m.tokens.mode && m.tokens.mode.default && m.tokens.mode.default.$value;
    if (d === 'light' || d === 'dark') return d;
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function lang() {
    return chosen.lang || autoLang(identity);
  }
  function mode() {
    return chosen.mode || autoMode(identity);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* A library recipe as DOM, rebuilt node by node from the allow-list (recipe.js): the recipe's markup is never
     inserted as such (parsed in an inert document, so nothing in it can load or run). Values go in as text only.
     A recipe outside the allow-list is not drawn: a plain element with the label stands in. */
  function fromRecipe(recipe, values) {
    var plain = el('span', null, values.label || values.title || '');
    if (!H.recipe || !recipe || H.recipe.check(recipe).length) return plain;
    var doc = document.implementation.createHTMLDocument('');
    var box = doc.createElement('div');
    box.innerHTML = recipe.html; // an inert document: no image loads, no handler runs
    function copy(src) {
      if (src.nodeType === 3) {
        return document.createTextNode(
          src.nodeValue.replace(/\{([a-z]+)\}/g, function (all, k) {
            return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : '';
          })
        );
      }
      if (src.nodeType !== 1 || src.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
      var name = src.localName;
      if (!H.recipe.isTag(name)) return null;
      var n = document.createElement(name);
      Array.prototype.forEach.call(src.attributes, function (a) {
        if (H.recipe.isAttribute(a.name)) n.setAttribute(a.name, a.value);
      });
      Array.prototype.forEach.call(src.childNodes, function (c) {
        var k = copy(c);
        if (k) n.appendChild(k);
      });
      return n;
    }
    var first = box.firstElementChild ? copy(box.firstElementChild) : null;
    return first || plain;
  }

  // A recipe's CSS, only when the recipe passes the allow-list.
  function recipeCss(tpl) {
    return tpl && tpl.recipe && H.recipe && !H.recipe.check(tpl.recipe).length ? tpl.recipe.css : '';
  }

  /* Scene sizes picked from the type scale around the base size (the names vary with the number of steps). */
  function sizes(id) {
    var ts = id.tokens.typeScale;
    var steps = ts.steps;
    var b = steps.indexOf(ts.base);
    if (b === -1) b = 0;
    var at = function (d) {
      return steps[Math.max(0, Math.min(steps.length - 1, b + d))] / 16 + 'rem';
    };
    return { '--sc-small': at(-1), '--sc-body': at(0), '--sc-h3': at(1), '--sc-h2': at(2), '--sc-h1': at(3) };
  }

  function draw() {
    if (!shadow || !identity) return;
    var scene = H.scenes && H.scenes[sceneName];
    if (!scene) return;
    var L = lang();
    var M = mode();
    var button = template('buttons', identity.extensions.components.button);
    var card = template('cards', identity.extensions.components.card);

    var style = el('style');
    style.textContent = [BASE, recipeCss(button), recipeCss(card), scene.css].join('\n');

    var wrap = el('div', 'scene');
    wrap.setAttribute('dir', L === 'ar' ? 'rtl' : 'ltr');
    wrap.setAttribute('lang', L);
    wrap.setAttribute('data-mode', M);
    wrap.setAttribute('data-scene', sceneName);
    wrap.style.colorScheme = M;
    H.generate.cssVariables(identity, M).forEach(function (p) {
      wrap.style.setProperty(p[0], p[1]);
    });
    // The scene's language decides the line height (Arabic needs more), like the exported pages do.
    wrap.style.setProperty('--line-height', String(identity.tokens.font.lineHeight[L]));
    var sz = sizes(identity);
    Object.keys(sz).forEach(function (k) {
      wrap.style.setProperty(k, sz[k]);
    });

    wrap.appendChild(
      scene.render({
        lang: L,
        mode: M,
        el: el,
        brand: identity.name,
        // Numbers in the preview language; Arabic uses the identity's digits (latn or arab).
        num: function (n, opts) {
          var locale = L === 'ar' ? 'ar-u-nu-' + identity.extensions.numerals : 'en-u-nu-latn';
          try {
            return new Intl.NumberFormat(locale, opts).format(n);
          } catch (e) {
            return String(n);
          }
        },
        icon: function (meaning) {
          var tpl = template('icons', identity.selections.icons && identity.selections.icons.template);
          var ext = identity.extensions;
          var node =
            tpl && H.icons
              ? H.icons.render(tpl, meaning, {
                  fill: ext.icons.fill,
                  container: ext.icons.container,
                  mirror: ext.rtl.mirror
                })
              : null;
          return node || el('span', 'hw-icon');
        },
        button: function (label) {
          return button ? fromRecipe(button.recipe, { label: label }) : el('button', null, label);
        },
        card: function (title, body) {
          return card ? fromRecipe(card.recipe, { title: title, body: body }) : el('div', null, title);
        }
      })
    );

    shadow.textContent = '';
    shadow.appendChild(style);
    shadow.appendChild(wrap);
    host.setAttribute('data-lang', L);
    host.setAttribute('data-mode', M);
    document.dispatchEvent(new CustomEvent('hawiya:preview', { detail: { lang: L, mode: M, scene: sceneName } }));
  }

  H.preview = {
    mount: function (elm) {
      host = elm;
      shadow = elm.attachShadow({ mode: 'open' });
    },
    render: function (id) {
      identity = id;
      draw();
    },
    setLang: function (l) {
      if (l !== 'ar' && l !== 'en') return;
      chosen.lang = l;
      draw();
    },
    setScene: function (name) {
      if (!H.scenes || !Object.prototype.hasOwnProperty.call(H.scenes, name)) return;
      sceneName = name;
      draw();
    },
    setMode: function (m) {
      if (m !== 'light' && m !== 'dark') return;
      chosen.mode = m;
      draw();
    },
    // The gallery's button and card samples draw recipes the same way (elements/components.js).
    fromRecipe: fromRecipe,
    lang: lang,
    mode: mode,
    scene: function () {
      return sceneName;
    }
  };
})();
