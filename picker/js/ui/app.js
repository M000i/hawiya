/* Prototype controller: one identity, three choices (color, font, radius). */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});

  var SWATCHES = [
    { value: '#2563eb', name: 'أزرق' },
    { value: '#0f766e', name: 'أخضر مزرق' },
    { value: '#7c3aed', name: 'بنفسجي' },
    { value: '#b91c1c', name: 'أحمر' },
    { value: '#1f2937', name: 'فحمي' }
  ];

  var FONTS = {
    'ibm-plex-sans-arabic': {
      label: 'IBM Plex Sans Arabic',
      family: '"IBM Plex Sans Arabic"',
      query: 'IBM+Plex+Sans+Arabic:wght@400;700'
    },
    cairo: { label: 'Cairo', family: '"Cairo"', query: 'Cairo:wght@400;700' },
    tajawal: { label: 'Tajawal', family: '"Tajawal"', query: 'Tajawal:wght@400;700' }
  };

  var IDENTITY = {
    id: 'calm-corporate',
    color: '#2563eb',
    font: 'ibm-plex-sans-arabic',
    radius: 8
  };

  var state = { identity: IDENTITY.id, color: IDENTITY.color, font: IDENTITY.font, radius: IDENTITY.radius };

  var loadedFonts = {};
  function loadFont(key) {
    if (loadedFonts[key]) return;
    loadedFonts[key] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + FONTS[key].query + '&display=swap';
    document.head.appendChild(link);
  }

  function isHex(v) {
    return /^#[0-9a-f]{6}$/i.test(v);
  }

  var els = {};

  function buildSwatches() {
    SWATCHES.forEach(function (s, i) {
      var label = document.createElement('label');
      label.className = 'swatch';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'color';
      input.value = s.value;
      input.id = 'swatch-' + i;
      input.setAttribute('aria-label', s.name);
      var dot = document.createElement('span');
      dot.style.background = s.value;
      dot.title = s.name;
      label.appendChild(input);
      label.appendChild(dot);
      els.swatches.appendChild(label);
    });
  }

  function buildFonts() {
    Object.keys(FONTS).forEach(function (key) {
      loadFont(key);
      var f = FONTS[key];
      var label = document.createElement('label');
      label.className = 'font-option';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'font';
      input.value = key;
      var sample = document.createElement('span');
      sample.className = 'font-sample';
      sample.style.fontFamily = f.family + ', system-ui, sans-serif';
      sample.textContent = 'هوية واضحة';
      var name = document.createElement('span');
      name.className = 'font-label';
      name.textContent = f.label;
      label.appendChild(input);
      label.appendChild(sample);
      label.appendChild(name);
      els.fonts.appendChild(label);
    });
  }

  function syncControls() {
    var radios = els.swatches.querySelectorAll('input[name="color"]');
    Array.prototype.forEach.call(radios, function (r) {
      r.checked = r.value.toLowerCase() === state.color.toLowerCase();
    });
    els.colorInput.value = state.color;
    var fontRadios = els.fonts.querySelectorAll('input[name="font"]');
    Array.prototype.forEach.call(fontRadios, function (r) {
      r.checked = r.value === state.font;
    });
    els.radiusInput.value = String(state.radius);
    els.radiusValue.textContent = state.radius + ' px';
    els.identityBtn.setAttribute('aria-pressed', String(state.identity === IDENTITY.id));
  }

  /* The exact input the generator receives; the preview reads the generator's own derived values. */
  H.getGeneratorInput = function () {
    return { name: 'مؤسسي هادئ', primary: state.color, fontFamily: FONTS[state.font].label, radius: state.radius };
  };

  function render() {
    syncControls();
    var d = H.generate.derive(H.getGeneratorInput());
    H.preview.render({
      primary: d.primary,
      onPrimary: d.onPrimary,
      accentText: d.accentText,
      fontFamily: FONTS[state.font].family,
      radius: d.radius.md
    });
    document.dispatchEvent(new CustomEvent('hawiya:change', { detail: H.getState() }));
  }

  function update(patch) {
    Object.keys(patch).forEach(function (k) {
      state[k] = patch[k];
    });
    var matches =
      state.color.toLowerCase() === IDENTITY.color &&
      state.font === IDENTITY.font &&
      state.radius === IDENTITY.radius;
    state.identity = matches ? IDENTITY.id : null;
    render();
  }

  H.getState = function () {
    return { identity: state.identity, color: state.color, font: state.font, radius: state.radius };
  };

  function init() {
    els.swatches = document.getElementById('swatches');
    els.colorInput = document.getElementById('color-input');
    els.fonts = document.getElementById('fonts');
    els.radiusInput = document.getElementById('radius-input');
    els.radiusValue = document.getElementById('radius-value');
    els.identityBtn = document.getElementById('identity-btn');

    buildSwatches();
    buildFonts();
    H.preview.mount(document.getElementById('preview'));

    els.swatches.addEventListener('change', function (e) {
      if (e.target.name === 'color' && isHex(e.target.value)) update({ color: e.target.value.toLowerCase() });
    });
    els.colorInput.addEventListener('input', function (e) {
      if (isHex(e.target.value)) update({ color: e.target.value.toLowerCase() });
    });
    els.fonts.addEventListener('change', function (e) {
      if (e.target.name === 'font' && FONTS[e.target.value]) update({ font: e.target.value });
    });
    els.radiusInput.addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isNaN(v)) update({ radius: v });
    });
    els.identityBtn.addEventListener('click', function () {
      update({ color: IDENTITY.color, font: IDENTITY.font, radius: IDENTITY.radius });
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
