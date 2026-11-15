/*
 * Preview scene: a landing page (task 2.6, R-028). Browser: window.Hawiya.scenes.landing.
 *
 * The text below is sample content of the product being designed, in both preview languages; it is not the
 * tool's own interface text (that lives in picker/i18n/). The scene builds its DOM with createElement and
 * textContent only; buttons and cards come from the chosen library recipes through ctx.button / ctx.card.
 * Styles use only the identity's CSS variables and logical properties.
 */
(function (root) {
  'use strict';

  var H = (root.Hawiya = root.Hawiya || {});
  H.scenes = H.scenes || {};

  var TEXT = {
    ar: {
      nav: ['المزايا', 'الأسعار', 'الأسئلة'],
      badge: 'جديد',
      title: 'أدِر فريقك من مكان واحد',
      lead: 'خطط مهامك، وتابع التقدم، وشارك النتائج مع فريقك في دقائق، بالعربي ومن اليمين لليسار.',
      primary: 'ابدأ مجانًا',
      secondary: 'شاهد كيف يعمل',
      cards: [
        ['تخطيط واضح', 'قسّم العمل إلى مهام صغيرة وحدّد لكل مهمة موعدًا ومسؤولًا.'],
        ['تقارير فورية', 'أرقام التقدم تتحدث مع كل تغيير، بلا جداول يدوية.'],
        ['تعاون بلا فوضى', 'التعليقات والملفات في مكانها، والجميع يرى آخر نسخة.']
      ],
      footer: 'جميع الحقوق محفوظة 2026'
    },
    en: {
      nav: ['Features', 'Pricing', 'FAQ'],
      badge: 'New',
      title: 'Run your team from one place',
      lead: 'Plan tasks, follow progress and share results with your team in minutes.',
      primary: 'Start for free',
      secondary: 'See how it works',
      cards: [
        ['Clear planning', 'Split work into small tasks, each with a date and an owner.'],
        ['Live reports', 'Progress numbers update with every change, no manual sheets.'],
        ['Calm teamwork', 'Comments and files stay in place, and everyone sees the latest version.']
      ],
      footer: 'All rights reserved 2026'
    }
  };

  var CSS = [
    '.sc-landing { display: grid; gap: var(--space-6); padding-block: var(--space-5); padding-inline: var(--space-5); }',
    '.sc-nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3) var(--space-5); padding-block-end: var(--space-3); border-block-end: 1px solid var(--color-border); }',
    '.sc-logo { font-family: var(--font-heading); font-weight: 700; font-size: var(--sc-h3); color: var(--color-on-surface); overflow-wrap: anywhere; }',
    '.sc-links { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-inline-start: auto; }',
    '.sc-links a { color: var(--color-muted-text); text-decoration: none; font-size: var(--sc-small); }',
    '.sc-hero { display: grid; gap: var(--space-3); max-inline-size: 40rem; }',
    '.sc-badge { justify-self: start; padding-block: 2px; padding-inline: var(--space-3); font-size: var(--sc-small); color: var(--color-accent-text); border: 1px solid var(--color-control-border); border-radius: var(--radius-full); }',
    '.sc-hero h1 { margin: 0; font-family: var(--font-heading); font-size: var(--sc-h1); line-height: 1.25; color: var(--color-on-surface); }',
    '.sc-lead { margin: 0; font-size: var(--sc-body); color: var(--color-muted-text); }',
    '.sc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-block-start: var(--space-2); }',
    '.sc-link { color: var(--color-accent-text); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }',
    '.sc-cards { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }',
    '.sc-footer { padding-block-start: var(--space-3); border-block-start: 1px solid var(--color-border); font-size: var(--sc-small); color: var(--color-muted-text); }'
  ].join('\n');

  function render(ctx) {
    var T = TEXT[ctx.lang] || TEXT.ar;
    var el = ctx.el;
    var root = el('div', 'sc-landing');

    var nav = el('header', 'sc-nav');
    nav.appendChild(el('span', 'sc-logo', ctx.brand));
    var links = el('nav', 'sc-links');
    T.nav.forEach(function (label) {
      var a = el('a', null, label);
      a.setAttribute('href', '#');
      a.setAttribute('tabindex', '-1');
      links.appendChild(a);
    });
    nav.appendChild(links);
    root.appendChild(nav);

    var hero = el('section', 'sc-hero');
    hero.appendChild(el('span', 'sc-badge', T.badge));
    hero.appendChild(el('h1', null, T.title));
    hero.appendChild(el('p', 'sc-lead', T.lead));
    var actions = el('div', 'sc-actions');
    actions.appendChild(ctx.button(T.primary));
    actions.appendChild(el('span', 'sc-link', T.secondary));
    hero.appendChild(actions);
    root.appendChild(hero);

    var cards = el('section', 'sc-cards');
    T.cards.forEach(function (c) {
      cards.appendChild(ctx.card(c[0], c[1]));
    });
    root.appendChild(cards);

    root.appendChild(el('footer', 'sc-footer', T.footer));
    return root;
  }

  H.scenes.landing = { css: CSS, render: render, text: TEXT };
})(typeof self !== 'undefined' ? self : this);
