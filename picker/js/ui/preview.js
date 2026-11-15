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
    '.scene *, .scene *::before, .scene *::after { box-sizing: border-box; }'
  ].join('\n');

  var host = null;
  var shadow = null;
  var identity = null;
  var sceneName = 'landing';
  var chosen = { lang: null, mode: null }; // null = follow the identity

  function template(element, id) {
    var list = (H.data && H.data.templates && H.data.templates[element]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
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

  /* A library recipe as DOM: its HTML is reviewed library content; the values go in as text only. */
  function fromRecipe(recipe, values) {
    var tpl = document.createElement('template');
    tpl.innerHTML = recipe.html;
    var walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      node.nodeValue = node.nodeValue.replace(/\{([a-z]+)\}/g, function (all, k) {
        return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : '';
      });
    });
    var first = tpl.content.firstElementChild;
    return first ? document.importNode(first, true) : el('span', null, values.label || values.title || '');
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
    style.textContent = [BASE, button ? button.recipe.css : '', card ? card.recipe.css : '', scene.css].join('\n');

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
    lang: lang,
    mode: mode,
    scene: function () {
      return sceneName;
    }
  };
})();
