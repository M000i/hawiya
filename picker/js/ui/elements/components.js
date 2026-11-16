/*
 * Buttons and cards galleries (task 2.13, R-048/R-049).
 * Browser: window.Hawiya.galleryParts.buttons and window.Hawiya.galleryParts.cards.
 *
 * Every card draws the template's real recipe (its HTML and CSS from the library, looked up by id each time)
 * in the current identity's colors, fonts, radii and shadows, in the mode the preview shows. Each sample has its
 * own shadow root, because all button recipes share the class .hw-btn and all card recipes .hw-card. The sample
 * is a picture only: it cannot be focused or clicked, so a click chooses the card around it. Choosing a card
 * changes every button (or card) in the preview scenes, which read the same recipe by id (preview.js).
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  H.galleryParts = H.galleryParts || {};

  var STAGE =
    ':host{display:block;inline-size:100%}' +
    '.c-stage{display:flex;align-items:center;justify-content:center;box-sizing:border-box;inline-size:100%;' +
    'min-block-size:64px;padding:12px;border-radius:8px;pointer-events:none;' +
    'background:var(--color-background);color:var(--color-on-surface);font-family:var(--font-body)}' +
    '.c-stage>*{max-inline-size:100%;box-sizing:border-box;text-align:start}' +
    // The page's «reduce motion» rule does not reach inside this shadow root (task 2.22).
    '@media (prefers-reduced-motion: reduce){.c-stage *{transition:none!important;animation:none!important}}';

  function values(element, t) {
    if (element === 'buttons') return { label: t('components.sample.button') };
    return { title: t('components.sample.cardTitle'), body: t('components.sample.cardBody') };
  }

  // Draws one sample: the recipe found by id, the identity's variables for the preview's mode.
  function draw(host, element, identity, t) {
    var tpl = H.library.find(element, host.getAttribute('data-recipe'));
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.textContent = '';
    if (!tpl || !tpl.recipe) return;
    var mode = H.preview && H.preview.mode ? H.preview.mode() : 'light';
    var style = document.createElement('style');
    var css = STAGE + '\n' + tpl.recipe.css;
    style.textContent = css;
    var stage = document.createElement('div');
    stage.className = 'c-stage';
    stage.setAttribute('inert', '');
    stage.setAttribute('data-mode', mode);
    stage.style.colorScheme = mode;
    H.generate.cssVariables(identity, mode).forEach(function (p) {
      stage.style.setProperty(p[0], p[1]);
    });
    stage.style.setProperty('--line-height', String(identity.tokens.font.lineHeight.ar));
    stage.appendChild(H.preview.fromRecipe(tpl.recipe, values(element, t)));
    root.appendChild(style);
    root.appendChild(stage);
  }

  function redraw(panel, element, identity, t) {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-recipe]'), function (host) {
      draw(host, element, identity, t);
    });
  }

  function part(element) {
    var shown = null; // the open panel, redrawn when the preview changes mode
    document.addEventListener('hawiya:preview', function () {
      if (shown && shown.isConnected && H.state) redraw(shown, element, H.state.identity(), H.i18n.t);
    });
    return {
      sample: function (tpl, ctx) {
        var host = ctx.el('span', 'g-sample c-sample');
        host.setAttribute('data-recipe', tpl.id);
        host.setAttribute('aria-hidden', 'true');
        return host;
      },
      update: function (panel, ctx) {
        shown = panel;
        redraw(panel, element, ctx.identity, ctx.t);
      }
    };
  }

  H.galleryParts.buttons = part('buttons');
  H.galleryParts.cards = part('cards');
})();
