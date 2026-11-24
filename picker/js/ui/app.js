/*
 * Prototype controls (color, font, corners) on top of the real choices (task 2.5): every control edits
 * H.state (one template per element plus adjustments), so each change is part of the identity that is saved
 * as the draft. The full galleries replace these controls in tasks 2.8 to 2.13.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;

  // Labels are i18n keys (picker/i18n/); the text follows the interface language.
  var SWATCHES = [
    { value: '#2563eb', key: 'color.blue' },
    { value: '#0f766e', key: 'color.teal' },
    { value: '#7c3aed', key: 'color.violet' },
    { value: '#b91c1c', key: 'color.red' },
    { value: '#1f2937', key: 'color.charcoal' }
  ];

  var els = {};

  function isHex(v) {
    return /^#[0-9a-f]{6}$/i.test(v);
  }

  function template(element, id) {
    return H.library.find(element, id);
  }

  // The families a font template names, without the spaces around them (task 9.2, CHG-8, R-109); H.fonts.load
  // skips a device font, which has no Google Fonts file.
  function families(fontTemplate) {
    var ex = fontTemplate.extras || {};
    var names = [];
    [ex.arabic, ex.latin, ex.headingArabic, ex.headingLatin, ex.numeralsFont].forEach(function (n) {
      if (typeof n === 'string' && n.trim() && names.indexOf(n.trim()) === -1) names.push(n.trim());
    });
    return names;
  }

  function cssFamily(fontTemplate) {
    var device = H.generate && H.generate.deviceFont;
    return (
      families(fontTemplate)
        .map(function (n) {
          return typeof device === 'function' && device(n) ? n : '"' + n + '"'; // a device font stays unquoted
        })
        .join(', ') + ', system-ui, sans-serif'
    );
  }

  function buildSwatches() {
    SWATCHES.forEach(function (s, i) {
      var label = document.createElement('label');
      label.className = 'swatch';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'color';
      input.value = s.value;
      input.id = 'swatch-' + i;
      input.setAttribute('data-i18n-attr', 'aria-label:' + s.key);
      var dot = document.createElement('span');
      dot.style.background = s.value;
      dot.setAttribute('data-i18n-attr', 'title:' + s.key);
      label.appendChild(input);
      label.appendChild(dot);
      els.swatches.appendChild(label);
    });
  }

  function buildFonts() {
    // The quick font choice lists the fonts available now (the starter ones until the fonts gallery is opened).
    H.library.view().templates.fonts.forEach(function (f) {
      var label = document.createElement('label');
      label.className = 'font-option';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'font';
      input.value = f.id;
      var sample = document.createElement('span');
      sample.className = 'font-sample';
      sample.style.fontFamily = cssFamily(f);
      sample.setAttribute('data-i18n', 'font.sample');
      var name = document.createElement('span');
      name.className = 'font-label';
      name.textContent = families(f).join(' + '); // font family names are the same in both languages
      label.appendChild(input);
      label.appendChild(sample);
      label.appendChild(name);
      els.fonts.appendChild(label);
      H.fonts.observe(label, families(f)); // its files load when it comes on screen (task 2.11)
    });
  }

  /* What the controls show, read from the built identity (never from stored values). */
  function view() {
    var c = H.state.choices();
    var id = H.state.identity();
    return {
      choices: c,
      identity: id,
      color: id.tokens.color.light.primary,
      font: c.selections.fonts.template,
      radius: id.tokens.radius.md
    };
  }

  function syncControls(v) {
    Array.prototype.forEach.call(els.swatches.querySelectorAll('input[name="color"]'), function (r) {
      r.checked = r.value.toLowerCase() === v.color;
    });
    els.colorInput.value = v.color;
    Array.prototype.forEach.call(els.fonts.querySelectorAll('input[name="font"]'), function (r) {
      r.checked = r.value === v.font;
    });
    els.radiusInput.value = String(v.radius);
    els.radiusValue.textContent = t('radius.value', { value: v.radius });
  }

  function render() {
    var v = view();
    syncControls(v);
    // The chosen font is needed for the preview right away.
    H.fonts.load(families(template('fonts', v.font)));
    H.preview.render(v.identity);
    document.dispatchEvent(new CustomEvent('hawiya:change', { detail: H.getState() }));
  }

  H.getState = function () {
    var v = view();
    return { choices: v.choices, color: v.color, font: v.font, radius: v.radius };
  };

  /* Set an adjustment, or drop it when it equals the template's own value. */
  function setOverride(c, element, key, value, templateValue) {
    var s = c.selections[element];
    var ov = s.overrides || {};
    if (value === templateValue) delete ov[key];
    else ov[key] = value;
    if (Object.keys(ov).length) s.overrides = ov;
    else delete s.overrides;
  }

  function setColor(hex) {
    H.state.change(function (c) {
      var tpl = template('colors', c.selections.colors.template);
      setOverride(c, 'colors', 'primary', hex.toLowerCase(), tpl.tokens.color.primary.$value.hex.toLowerCase());
    });
  }

  function setRadius(px) {
    H.state.change(function (c) {
      var tpl = template('radius', c.selections.radius.template);
      setOverride(c, 'radius', 'md', px, tpl.tokens.radius.md.$value.value);
    });
  }

  function setFont(id) {
    H.state.change(function (c) {
      c.selections.fonts = { template: id };
    });
  }

  // The preview.open button on narrow screens (task 10.2, R-111, AC-31): the preview opens over the page as a dialog;
  // the close key or Esc closes it, and the page goes back to where it was, with the focus on the button.
  // Widening the window to 760 px or more closes it too, since the preview is then pinned beside the choices.
  function setupPreviewSheet() {
    var narrow = window.matchMedia('(max-width: 759.98px)'); // under 760 px, as in picker.css (R-111)
    var openBtn = document.getElementById('preview-open');
    var closeBtn = document.getElementById('preview-close');
    var wrap = document.getElementById('preview-wrap');
    var main = wrap.parentNode;
    var savedY = 0;
    var inerted = [];
    var isOpen = function () {
      return document.body.classList.contains('preview-sheet-open');
    };

    function open() {
      if (!narrow.matches || isOpen()) return;
      savedY = window.scrollY;
      // Everything but the preview leaves the keyboard and screen-reader order while it is open.
      inerted = Array.prototype.filter.call(document.body.children, function (n) {
        return n !== main && n.tagName !== 'SCRIPT' && !n.inert;
      });
      Array.prototype.forEach.call(main.children, function (n) {
        if (n !== wrap && !n.inert) inerted.push(n);
      });
      inerted.forEach(function (n) {
        n.inert = true;
      });
      document.body.classList.add('preview-sheet-open');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      openBtn.setAttribute('aria-expanded', 'true');
      wrap.scrollTop = 0;
      closeBtn.focus();
    }

    function close() {
      if (!isOpen()) return;
      document.body.classList.remove('preview-sheet-open');
      inerted.forEach(function (n) {
        n.inert = false;
      });
      inerted = [];
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-modal');
      openBtn.setAttribute('aria-expanded', 'false');
      window.scrollTo(0, savedY);
      openBtn.focus({ preventScroll: true });
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close();
      }
    });
    var onWidth = function () {
      if (!narrow.matches) close();
    };
    if (narrow.addEventListener) narrow.addEventListener('change', onWidth);
    else narrow.addListener(onWidth);
  }

  function init() {
    els.swatches = document.getElementById('swatches');
    els.colorInput = document.getElementById('color-input');
    els.fonts = document.getElementById('fonts');
    els.radiusInput = document.getElementById('radius-input');
    els.radiusValue = document.getElementById('radius-value');

    buildSwatches();
    buildFonts();
    H.i18n.apply(els.swatches);
    H.i18n.apply(els.fonts);
    document.addEventListener('hawiya:lang', function () {
      // apply() already refreshed every data-i18n element; only computed text is left.
      els.radiusValue.textContent = t('radius.value', { value: view().radius });
    });
    H.preview.mount(document.getElementById('preview'));

    els.swatches.addEventListener('change', function (e) {
      if (e.target.name === 'color' && isHex(e.target.value)) setColor(e.target.value);
    });
    els.colorInput.addEventListener('input', function (e) {
      if (isHex(e.target.value)) setColor(e.target.value);
    });
    els.fonts.addEventListener('change', function (e) {
      if (e.target.name === 'font' && template('fonts', e.target.value)) setFont(e.target.value);
    });
    els.radiusInput.addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isNaN(v)) setRadius(v);
    });
    // Preview keys: language and light/dark of the preview only (not the tool, not the identity).
    Array.prototype.forEach.call(document.querySelectorAll('[data-preview-lang]'), function (b) {
      b.addEventListener('click', function () {
        H.preview.setLang(b.getAttribute('data-preview-lang'));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-preview-mode]'), function (b) {
      b.addEventListener('click', function () {
        H.preview.setMode(b.getAttribute('data-preview-mode'));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-preview-scene]'), function (b) {
      b.addEventListener('click', function () {
        H.preview.setScene(b.getAttribute('data-preview-scene'));
      });
    });
    document.addEventListener('hawiya:preview', function (e) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview-scene]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-preview-scene') === e.detail.scene));
      });
      // The mobile scene is a layout in a fixed-width frame, not a device simulation (R-034).
      document.getElementById('approx-badge').hidden = e.detail.scene !== 'mobile';
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview-lang]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-preview-lang') === e.detail.lang));
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview-mode]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-preview-mode') === e.detail.mode));
      });
    });
    setupPreviewSheet();
    // The choices live in a <form> for grouping only: Enter in a text field must not reload the page.
    document.getElementById('controls').addEventListener('submit', function (e) {
      e.preventDefault();
    });
    document.addEventListener('hawiya:state', render);
    document.addEventListener('hawiya:refused', render); // a refused pick: the controls show the identity again

    render();
  }

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
