/*
 * Preview scene: a phone screen (task 2.7, R-028/R-034). Browser: window.Hawiya.scenes.mobile.
 * An approximate layout in a fixed-width frame (plan.md: not a device simulation); the tool shows the
 * "approximate" label next to the scene keys. Sample content in both preview languages, text-only DOM,
 * logical properties, only the identity's CSS variables.
 */
(function (root) {
  'use strict';

  var H = (root.Hawiya = root.Hawiya || {});
  H.scenes = H.scenes || {};

  var TEXT = {
    ar: {
      time: '9:41',
      title: 'مهام اليوم',
      tasks: [
        ['مراجعة التصميم', 'قبل الظهر'],
        ['اجتماع الفريق', 'الساعة 2'],
        ['إرسال الفاتورة', 'اليوم']
      ],
      card: ['أنجزت 3 من 5', 'استمر، بقي القليل.'],
      action: 'أضف مهمة',
      tabs: ['الرئيسية', 'المهام', 'الحساب']
    },
    en: {
      time: '9:41',
      title: "Today's tasks",
      tasks: [
        ['Review the design', 'Before noon'],
        ['Team meeting', 'At 2'],
        ['Send the invoice', 'Today']
      ],
      card: ['3 of 5 done', 'Keep going, almost there.'],
      action: 'Add a task',
      tabs: ['Home', 'Tasks', 'Account']
    }
  };

  var CSS = [
    '.sc-phone-stage { display: grid; place-items: center; padding: var(--space-5) var(--space-3); background: var(--color-surface); }',
    '.sc-phone { display: grid; grid-template-rows: auto auto 1fr auto; inline-size: min(22.5rem, 100%); block-size: 38rem; overflow: hidden; background: var(--color-background); border: 8px solid var(--color-on-surface); border-radius: 2rem; }',
    '.sc-status { display: flex; justify-content: center; padding-block: var(--space-1); font-size: var(--sc-small); font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.sc-appbar { padding-block: var(--space-2); padding-inline: var(--space-4); }',
    '.sc-appbar h2 { margin: 0; font-family: var(--font-heading); font-size: var(--sc-h2); }',
    '.sc-body { display: grid; align-content: start; gap: var(--space-3); padding-inline: var(--space-4); overflow-y: auto; }',
    '.sc-list { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }',
    '.sc-list li { display: flex; justify-content: space-between; gap: var(--space-2); padding-block: var(--space-3); padding-inline: var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }',
    '.sc-list small { color: var(--color-muted-text); white-space: nowrap; }',
    '.sc-body .hw-btn { inline-size: 100%; }',
    '.sc-tabs { display: flex; justify-content: space-around; padding-block: var(--space-2); border-block-start: 1px solid var(--color-border); font-size: var(--sc-small); color: var(--color-muted-text); }',
    '.sc-tabs span[aria-current] { color: var(--color-accent-text); font-weight: 700; }'
  ].join('\n');

  function render(ctx) {
    var T = TEXT[ctx.lang] || TEXT.ar;
    var el = ctx.el;
    var stage = el('div', 'sc-phone-stage');
    var phone = el('div', 'sc-phone');

    var status = el('div', 'sc-status', T.time);
    status.setAttribute('dir', 'ltr');
    phone.appendChild(status);

    var bar = el('header', 'sc-appbar');
    bar.appendChild(el('h2', null, T.title));
    phone.appendChild(bar);

    var body = el('div', 'sc-body');
    body.appendChild(ctx.card(T.card[0], T.card[1]));
    var list = el('ul', 'sc-list');
    T.tasks.forEach(function (task) {
      var li = el('li');
      li.appendChild(el('span', null, task[0]));
      li.appendChild(el('small', null, task[1]));
      list.appendChild(li);
    });
    body.appendChild(list);
    body.appendChild(ctx.button(T.action));
    phone.appendChild(body);

    var tabs = el('nav', 'sc-tabs');
    T.tabs.forEach(function (label, i) {
      var t = el('span', null, label);
      if (i === 0) t.setAttribute('aria-current', 'page');
      tabs.appendChild(t);
    });
    phone.appendChild(tabs);

    stage.appendChild(phone);
    return stage;
  }

  H.scenes.mobile = { css: CSS, render: render, text: TEXT };
})(typeof self !== 'undefined' ? self : this);
