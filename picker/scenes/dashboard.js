/*
 * Preview scene: a dashboard (task 2.7, R-028). Browser: window.Hawiya.scenes.dashboard.
 * Sample content in both preview languages (not the tool's interface text). Text-only DOM, logical properties,
 * only the identity's CSS variables. Numbers use ctx.num (the identity's digits in Arabic) and tabular figures.
 */
(function (root) {
  'use strict';

  var H = (root.Hawiya = root.Hawiya || {});
  H.scenes = H.scenes || {};

  var TEXT = {
    ar: {
      nav: ['نظرة عامة', 'الطلبات', 'العملاء', 'التقارير'],
      title: 'نظرة عامة',
      action: 'تقرير جديد',
      kpis: [
        ['الإيرادات (ريال)', 48250],
        ['الطلبات', 1284],
        ['العملاء الجدد', 312]
      ],
      tableTitle: 'آخر الطلبات',
      head: ['الطلب', 'العميل', 'الحالة'],
      rows: [
        ['1042', 'سارة أحمد', 'success', 'مكتمل'],
        ['1041', 'خالد العتيبي', 'warning', 'قيد التنفيذ'],
        ['1040', 'منى سالم', 'danger', 'ملغى']
      ]
    },
    en: {
      nav: ['Overview', 'Orders', 'Customers', 'Reports'],
      title: 'Overview',
      action: 'New report',
      kpis: [
        ['Revenue (SAR)', 48250],
        ['Orders', 1284],
        ['New customers', 312]
      ],
      tableTitle: 'Latest orders',
      head: ['Order', 'Customer', 'Status'],
      rows: [
        ['1042', 'Sara Ahmed', 'success', 'Completed'],
        ['1041', 'Khalid Alotaibi', 'warning', 'In progress'],
        ['1040', 'Mona Salem', 'danger', 'Cancelled']
      ]
    }
  };

  var CSS = [
    '.sc-dash { display: grid; grid-template-columns: 11rem minmax(0, 1fr); min-block-size: 26rem; }',
    '.sc-side { display: grid; align-content: start; gap: var(--space-1); padding: var(--space-4); background: var(--color-surface); border-inline-end: 1px solid var(--color-border); }',
    '.sc-brand { margin-block-end: var(--space-3); font-family: var(--font-heading); font-weight: 700; overflow-wrap: anywhere; }',
    '.sc-side a { display: block; padding-block: var(--space-1); padding-inline: var(--space-2); border-radius: var(--radius-sm); color: var(--color-muted-text); text-decoration: none; font-size: var(--sc-small); }',
    '.sc-side a[aria-current] { color: var(--color-on-surface); background: var(--color-background); font-weight: 700; }',
    '.sc-main { display: grid; align-content: start; gap: var(--space-5); padding: var(--space-5); min-inline-size: 0; }',
    '.sc-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }',
    '.sc-top h2 { margin: 0; font-family: var(--font-heading); font-size: var(--sc-h2); }',
    '.sc-kpis { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }',
    '.sc-kpi { display: grid; gap: var(--space-1); padding: var(--space-4); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }',
    '.sc-kpi span { color: var(--color-muted-text); font-size: var(--sc-small); }',
    '.sc-kpi strong { font-family: var(--font-numerals); font-size: var(--sc-h2); font-variant-numeric: tabular-nums; }',
    '.sc-table-wrap { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }',
    '.sc-table-wrap h3 { margin: 0; font-size: var(--sc-h3); }',
    '.sc-table { inline-size: 100%; border-collapse: collapse; font-size: var(--sc-small); }',
    '.sc-table th, .sc-table td { padding-block: var(--space-2); padding-inline: var(--space-2); text-align: start; border-block-end: 1px solid var(--color-border); }',
    '.sc-table th { color: var(--color-muted-text); font-weight: 700; }',
    '.sc-table td:first-child { font-family: var(--font-numerals); font-variant-numeric: tabular-nums; }',
    '.sc-pill { display: inline-block; padding-inline: var(--space-2); border: 1px solid currentColor; border-radius: var(--radius-full); font-size: var(--sc-small); }',
    '.sc-pill[data-tone="success"] { color: var(--color-success); }',
    '.sc-pill[data-tone="warning"] { color: var(--color-warning); }',
    '.sc-pill[data-tone="danger"] { color: var(--color-danger); }',
    '@container (max-width: 34rem) {',
    '  .sc-dash { grid-template-columns: minmax(0, 1fr); }',
    '  .sc-side { display: flex; flex-wrap: wrap; align-items: center; border-inline-end: 0; border-block-end: 1px solid var(--color-border); }',
    '  .sc-brand { margin-block-end: 0; margin-inline-end: var(--space-3); }',
    '}'
  ].join('\n');

  function render(ctx) {
    var T = TEXT[ctx.lang] || TEXT.ar;
    var el = ctx.el;
    var root = el('div', 'sc-dash');

    var side = el('nav', 'sc-side');
    side.appendChild(el('div', 'sc-brand', ctx.brand));
    T.nav.forEach(function (label, i) {
      var a = el('a', null, label);
      a.setAttribute('href', '#');
      a.setAttribute('tabindex', '-1');
      if (i === 0) a.setAttribute('aria-current', 'page');
      side.appendChild(a);
    });
    root.appendChild(side);

    var main = el('main', 'sc-main');
    var top = el('div', 'sc-top');
    top.appendChild(el('h2', null, T.title));
    top.appendChild(ctx.button(T.action));
    main.appendChild(top);

    var kpis = el('section', 'sc-kpis');
    T.kpis.forEach(function (k) {
      var box = el('div', 'sc-kpi');
      box.appendChild(el('span', null, k[0]));
      box.appendChild(el('strong', null, ctx.num(k[1])));
      kpis.appendChild(box);
    });
    main.appendChild(kpis);

    var wrap = el('section', 'sc-table-wrap');
    wrap.appendChild(el('h3', null, T.tableTitle));
    var table = el('table', 'sc-table');
    var thead = el('thead');
    var hr = el('tr');
    T.head.forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    T.rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, ctx.num(Number(r[0]), { useGrouping: false })));
      tr.appendChild(el('td', null, r[1]));
      var td = el('td');
      var pill = el('span', 'sc-pill', r[3]);
      pill.setAttribute('data-tone', r[2]);
      td.appendChild(pill);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    main.appendChild(wrap);
    root.appendChild(main);
    return root;
  }

  H.scenes.dashboard = { css: CSS, render: render, text: TEXT };
})(typeof self !== 'undefined' ? self : this);
