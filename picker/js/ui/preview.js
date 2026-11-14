/* Preview scene rendered inside a Shadow DOM so its styles never mix with the tool's. */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});

  var STYLE = [
    ':host { all: initial; display: block; }',
    '.scene { direction: rtl; font-family: var(--h-font), system-ui, sans-serif;',
    '  color: #111827; background: #ffffff; padding: 24px; border: 1px solid #e5e7eb;',
    '  border-radius: 12px; line-height: 1.7; }',
    '.card { max-inline-size: 420px; padding: 20px; background: #ffffff;',
    '  border: 1px solid #e5e7eb; border-radius: calc(var(--h-radius) * 1.5);',
    '  box-shadow: 0 1px 3px rgba(0,0,0,.08); }',
    '.badge { display: inline-block; padding: 2px 10px; font-size: 13px;',
    '  color: var(--h-primary); border: 1px solid var(--h-primary);',
    '  border-radius: var(--h-radius); }',
    'h3 { margin: 12px 0 4px; font-size: 22px; font-weight: 700; }',
    'p { margin: 0 0 16px; color: #4b5563; font-size: 15px; }',
    'label { display: block; margin-block-end: 6px; font-size: 14px; font-weight: 700; }',
    'input { display: block; inline-size: 100%; box-sizing: border-box; padding: 10px 12px;',
    '  font: inherit; border: 1px solid #d1d5db; border-radius: var(--h-radius); }',
    'input:focus { outline: 2px solid var(--h-primary); outline-offset: 1px; }',
    '.actions { display: flex; gap: 8px; margin-block-start: 16px; flex-wrap: wrap; }',
    'button { font: inherit; font-weight: 700; padding: 10px 18px; cursor: pointer;',
    '  border-radius: var(--h-radius); }',
    '.primary { background: var(--h-primary); color: var(--h-on-primary);',
    '  border: 1px solid var(--h-primary); }',
    '.secondary { background: transparent; color: var(--h-primary);',
    '  border: 1px solid var(--h-primary); }'
  ].join('\n');

  var MARKUP = [
    '<div class="scene">',
    '  <div class="card" part="card">',
    '    <span class="badge">جديد</span>',
    '    <h3>افتح حسابك في دقيقة</h3>',
    '    <p>أدخل بريدك وسنرسل لك رابط التفعيل. لا حاجة لبطاقة.</p>',
    '    <label for="pv-email">البريد الإلكتروني</label>',
    '    <input id="pv-email" type="email" placeholder="name@example.com" dir="ltr" />',
    '    <div class="actions">',
    '      <button class="primary" type="button">ابدأ الآن</button>',
    '      <button class="secondary" type="button">اعرف أكثر</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  var host = null;

  H.preview = {
    mount: function (el) {
      host = el;
      var root = el.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + STYLE + '</style>' + MARKUP;
    },

    /* tokens: { primary, onPrimary, fontFamily, radius } */
    render: function (tokens) {
      if (!host) return;
      host.style.setProperty('--h-primary', tokens.primary);
      host.style.setProperty('--h-on-primary', tokens.onPrimary);
      host.style.setProperty('--h-font', tokens.fontFamily);
      host.style.setProperty('--h-radius', tokens.radius + 'px');
    }
  };
})();
