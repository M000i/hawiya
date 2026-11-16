/*
 * Blocking and warning rules in the page (task 2.16, R-026/R-027). Browser: loads after state.js and rules.js.
 *
 * Block: every change is checked before it is applied (H.state.setGuard). A change that breaks a blocking rule
 *   is not applied; a message says why, and when the rules found a nearby color that passes, a button applies the
 *   same change with that color instead.
 * Warn: after every applied change the warning rules run; each warning shows with «Ignore». An ignored warning
 *   stays hidden until its values change (a different radius, line height, ...); ignoring lasts for this visit.
 * Messages come from the dictionaries (both languages) and are redrawn on a language switch.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;

  // Every key written out, so the dictionaries' check sees each one in use.
  var ROLE = {
    onSurface: { key: 'rules.role.onSurface' },
    mutedText: { key: 'rules.role.mutedText' },
    accentText: { key: 'rules.role.accentText' },
    success: { key: 'rules.role.success' },
    warning: { key: 'rules.role.warning' },
    danger: { key: 'rules.role.danger' },
    info: { key: 'rules.role.info' },
    onPrimary: { key: 'rules.role.onPrimary' },
    onSecondary: { key: 'rules.role.onSecondary' },
    background: { key: 'rules.role.background' },
    surface: { key: 'rules.role.surface' },
    primary: { key: 'rules.role.primary' },
    secondary: { key: 'rules.role.secondary' }
  };
  var MODE = { light: { key: 'rules.mode.light' }, dark: { key: 'rules.mode.dark' } };
  var LANG = { ar: { key: 'rules.lang.ar' }, en: { key: 'rules.lang.en' } };
  var SUGGEST = { primary: { key: 'rules.suggest.primary' }, secondary: { key: 'rules.suggest.secondary' } };

  var MAX_SHOWN = 4; // reasons listed in a block message; the rest are counted
  var box = null;
  var blocked = null; // { problems, suggestion, attempted } of the last refused change
  var ignored = {}; // warning key → true

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function find(element, id) {
    return H.library.find(element, id);
  }

  function reason(p) {
    if (p.rule === 'contrast') {
      return t('rules.block.contrast', {
        text: t(ROLE[p.text].key),
        on: t(ROLE[p.on].key),
        mode: t(MODE[p.mode].key),
        ratio: p.shown,
        required: p.required
      });
    }
    if (p.rule === 'font-language') {
      var langs = p.missing.map(function (l) {
        return t(LANG[l].key);
      });
      return t('rules.block.fontLanguage', { languages: langs.join(t('export.listSeparator')) });
    }
    if (p.rule === 'font-numerals') return t('rules.block.fontNumerals');
    if (p.rule === 'arabic-typography') return t('rules.block.arabicTypography', { property: p.property });
    if (p.rule === 'platform') return t('rules.block.platform', { platform: p.platform });
    return t('rules.block.other');
  }

  function warningText(w) {
    if (w.rule === 'thin-icons-heavy-font') return t('rules.warn.thinIcons', { weight: w.fontWeight });
    if (w.rule === 'button-radius-over-card') return t('rules.warn.buttonRadius', { button: w.button, card: w.card });
    if (w.rule === 'dark-shadows-vanish') return t('rules.warn.darkShadows');
    if (w.rule === 'arabic-line-height') {
      return t('rules.warn.arabicLine', { value: w.lineHeight, minimum: w.minimum });
    }
    if (w.rule === 'display-font-body') return t('rules.warn.displayFont');
    return t('rules.warn.other');
  }

  // A warning comes back when its values change: the key is the rule with its data.
  function keyOf(w) {
    return JSON.stringify(w);
  }

  function currentWarnings() {
    if (!H.rules || !H.state) return [];
    return H.rules.warnings(H.state.identity(), find).warnings.filter(function (w) {
      return !ignored[keyOf(w)];
    });
  }

  function applySuggestion() {
    if (!blocked || !blocked.suggestion) return;
    var attempted = blocked.attempted;
    var overrides = blocked.suggestion.overrides;
    H.state.change(function (c) {
      Object.keys(c).forEach(function (k) {
        delete c[k];
      });
      Object.keys(attempted).forEach(function (k) {
        c[k] = attempted[k];
      });
      var s = c.selections.colors;
      s.overrides = s.overrides || {};
      Object.keys(overrides).forEach(function (k) {
        s.overrides[k] = overrides[k];
      });
    });
  }

  function blockSection() {
    var sec = el('section', 'r-block');
    sec.setAttribute('role', 'alert');
    sec.setAttribute('data-rules-block', 'true');
    var title = el('p', 'r-title');
    title.textContent = t('rules.blocked.title');
    sec.appendChild(title);
    var seen = {};
    var reasons = [];
    blocked.problems.forEach(function (p) {
      var text = reason(p);
      if (!seen[text]) {
        seen[text] = true;
        reasons.push(text);
      }
    });
    var list = el('ul', 'r-reasons');
    reasons.slice(0, MAX_SHOWN).forEach(function (text) {
      var li = el('li');
      li.textContent = text;
      list.appendChild(li);
    });
    if (reasons.length > MAX_SHOWN) {
      var more = el('li');
      more.textContent = t('rules.more', { count: reasons.length - MAX_SHOWN });
      list.appendChild(more);
    }
    sec.appendChild(list);

    var actions = el('div', 'r-actions');
    var sug = blocked.suggestion;
    if (sug) {
      var colors = el('p', 'r-suggestion');
      colors.setAttribute('data-rules-suggestion', 'true');
      Object.keys(sug.overrides).forEach(function (k) {
        var chip = el('span', 'r-chip');
        var dot = el('span', 'r-dot');
        dot.style.background = sug.overrides[k];
        chip.appendChild(dot);
        var label = el('span');
        label.textContent = t(SUGGEST[k].key);
        chip.appendChild(label);
        // The color code reads left to right in both languages.
        var code = el('code', 'r-code');
        code.setAttribute('dir', 'ltr');
        var text = sug.overrides[k].toUpperCase();
        code.textContent = text;
        chip.appendChild(code);
        colors.appendChild(chip);
      });
      sec.appendChild(colors);
      var apply = el('button', 'r-apply');
      apply.type = 'button';
      apply.setAttribute('data-rules-apply', 'true');
      apply.textContent = t('rules.suggest.apply');
      apply.addEventListener('click', applySuggestion);
      actions.appendChild(apply);
    } else {
      var none = el('p', 'note');
      none.textContent = t('rules.suggest.none');
      sec.appendChild(none);
    }
    var close = el('button', 'r-close');
    close.type = 'button';
    close.setAttribute('data-rules-dismiss', 'true');
    close.textContent = t('rules.dismiss');
    close.addEventListener('click', function () {
      blocked = null;
      render();
      // Fields that still show the refused value (a typed color) go back to the identity's.
      document.dispatchEvent(new CustomEvent('hawiya:refused'));
    });
    actions.appendChild(close);
    sec.appendChild(actions);
    return sec;
  }

  function warnSection(warnings) {
    var sec = el('section', 'r-warn');
    sec.setAttribute('data-rules-warnings', 'true');
    var title = el('p', 'r-title');
    title.textContent = t('rules.warnings.title');
    sec.appendChild(title);
    var list = el('ul', 'r-reasons');
    warnings.forEach(function (w) {
      var li = el('li', 'r-warning');
      li.setAttribute('data-rules-warning', w.rule);
      var span = el('span');
      var text = warningText(w);
      span.textContent = text;
      li.appendChild(span);
      var ignore = el('button', 'r-ignore');
      ignore.type = 'button';
      ignore.setAttribute('data-rules-ignore', w.rule);
      ignore.textContent = t('rules.ignore');
      ignore.addEventListener('click', function () {
        ignored[keyOf(w)] = true;
        render();
      });
      li.appendChild(ignore);
      list.appendChild(li);
    });
    sec.appendChild(list);
    return sec;
  }

  function render() {
    if (!box) return;
    box.textContent = '';
    var warnings = currentWarnings();
    if (blocked) box.appendChild(blockSection());
    if (warnings.length) box.appendChild(warnSection(warnings));
    box.hidden = !blocked && !warnings.length;
  }

  // Asked before every change: refuse it when a blocking rule is broken, and say why.
  function guard(choices, identity) {
    var r = H.rules.identity(identity, find);
    if (r.allowed) {
      blocked = null;
      return true;
    }
    blocked = { problems: r.problems, suggestion: r.suggestion, attempted: choices };
    render();
    return false;
  }

  function init() {
    box = document.getElementById('rules');
    if (!box || !H.rules) return;
    H.state.setGuard(guard);
    document.addEventListener('hawiya:state', render);
    document.addEventListener('hawiya:lang', render);
    render();
  }

  H.rulesUi = {
    // For the page's own checks: what is shown now.
    blocked: function () {
      return blocked ? JSON.parse(JSON.stringify(blocked)) : null;
    }
  };

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
