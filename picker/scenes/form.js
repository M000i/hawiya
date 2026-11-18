/*
 * Preview scene: a form (task 2.7, R-028). Browser: window.Hawiya.scenes.form.
 * Sample content in both preview languages (not the tool's interface text). Text-only DOM, logical properties,
 * only the identity's CSS variables. Fields cannot be typed into: they show the style, not a working form.
 */
(function (root) {
  'use strict';

  var H = (root.Hawiya = root.Hawiya || {});
  H.scenes = H.scenes || {};

  var TEXT = {
    ar: {
      title: 'أنشئ حسابك',
      lead: 'خطوة واحدة وتبدأ. لا نطلب بطاقة دفع.',
      fields: [
        ['الاسم الكامل', 'text', 'سارة أحمد', ''],
        ['البريد الإلكتروني', 'email', 'sara@example', 'اكتب بريدًا صحيحًا، مثل name@example.com']
      ],
      plan: 'الباقة',
      plans: ['الأساسية', 'المتقدمة'],
      agree: 'أوافق على الشروط وسياسة الخصوصية',
      submit: 'أنشئ الحساب',
      alt: 'لدي حساب بالفعل'
    },
    en: {
      title: 'Create your account',
      lead: 'One step and you are in. No card needed.',
      fields: [
        ['Full name', 'text', 'Sara Ahmed', ''],
        ['Email', 'email', 'sara@example', 'Type a valid email, like name@example.com']
      ],
      plan: 'Plan',
      plans: ['Basic', 'Advanced'],
      agree: 'I agree to the terms and the privacy policy',
      submit: 'Create account',
      alt: 'I already have an account'
    }
  };

  var CSS = [
    '.sc-form-page { display: grid; place-items: center; padding: var(--space-6) var(--space-4); background: var(--color-surface); }',
    '.sc-form { display: grid; gap: var(--space-4); inline-size: 100%; max-inline-size: 26rem; padding: var(--space-5); background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }',
    '.sc-form h2 { margin: 0; font-family: var(--font-heading); font-size: var(--sc-h2); }',
    '.sc-form p { margin: 0; color: var(--color-muted-text); font-size: var(--sc-small); }',
    '.sc-field { display: grid; gap: var(--space-1); }',
    '.sc-field label, .sc-legend { font-weight: 700; font-size: var(--sc-small); }',
    '.sc-input { inline-size: 100%; padding-block: var(--space-2); padding-inline: var(--space-3); font: inherit; color: var(--color-on-surface); background: var(--color-background); border: 1px solid var(--color-control-border); border-radius: var(--radius-md); }',
    '.sc-input[aria-invalid="true"] { border-color: var(--color-danger); }',
    '.sc-input:focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }',
    '.sc-error { color: var(--color-danger); font-size: var(--sc-small); }',
    '.sc-choices { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.sc-choice { padding-block: var(--space-1); padding-inline: var(--space-3); border: 1px solid var(--color-control-border); border-radius: var(--radius-md); font-size: var(--sc-small); }',
    '.sc-choice[aria-checked="true"] { color: var(--color-accent-text); border-color: var(--color-accent-text); font-weight: 700; }',
    '.sc-check { display: flex; align-items: center; gap: var(--space-2); font-size: var(--sc-small); }',
    '.sc-box { inline-size: 1.1em; block-size: 1.1em; border-radius: var(--radius-sm); background: var(--color-primary); border: 1px solid var(--color-primary); }',
    '.sc-form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }',
    '.sc-link { color: var(--color-accent-text); text-decoration: underline; text-underline-offset: 3px; font-size: var(--sc-small); }',
    // Phone width (task 5.5, B-076): a large spacing of the identity does not squeeze the form below its button.
    '@container (max-width: 34rem) {',
    '  .sc-form-page { padding: var(--space-4) var(--space-2); }',
    '  .sc-form { padding: var(--space-4); }',
    '}'
  ].join('\n');

  function render(ctx) {
    var T = TEXT[ctx.lang] || TEXT.ar;
    var el = ctx.el;
    var page = el('div', 'sc-form-page');
    var form = el('div', 'sc-form');
    form.appendChild(el('h2', null, T.title));
    form.appendChild(el('p', null, T.lead));

    T.fields.forEach(function (f, i) {
      var field = el('div', 'sc-field');
      var id = 'sc-f' + i;
      var label = el('label', null, f[0]);
      label.setAttribute('for', id);
      field.appendChild(label);
      var input = el('input', 'sc-input');
      input.id = id;
      input.type = f[1];
      input.value = f[2];
      input.readOnly = true;
      input.tabIndex = -1;
      if (f[1] === 'email') input.setAttribute('dir', 'ltr'); // addresses are always left to right
      field.appendChild(input);
      if (f[3]) {
        input.setAttribute('aria-invalid', 'true');
        field.appendChild(el('span', 'sc-error', f[3]));
      }
      form.appendChild(field);
    });

    var plan = el('div', 'sc-field');
    plan.appendChild(el('span', 'sc-legend', T.plan));
    var choices = el('div', 'sc-choices');
    T.plans.forEach(function (p, i) {
      var c = el('span', 'sc-choice', p);
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(i === 0));
      choices.appendChild(c);
    });
    plan.appendChild(choices);
    form.appendChild(plan);

    var check = el('div', 'sc-check');
    check.appendChild(el('span', 'sc-box'));
    check.appendChild(el('span', null, T.agree));
    form.appendChild(check);

    var actions = el('div', 'sc-form-actions');
    actions.appendChild(ctx.button(T.submit));
    actions.appendChild(el('span', 'sc-link', T.alt));
    form.appendChild(actions);

    page.appendChild(form);
    return page;
  }

  H.scenes.form = { css: CSS, render: render, text: TEXT };
})(typeof self !== 'undefined' ? self : this);
