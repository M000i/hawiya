/*
 * The «Fill the rest for me» button (task 2.18, R-024 / AC-16). Browser: loads after state.js, library.js,
 * autofill.js and gallery.js.
 *
 * The button shows once the user has chosen two elements or more (H.state.chosen()), at least one of them a style
 * (not only the mode and direction settings), and some are left. A press
 * loads every element's full list, fills each element the user did not choose (H.autofill.fill: the best fit
 * among the templates that keep every blocking rule), and applies the result as one change. Each filled element
 * is marked «Filled automatically» in the advanced list until the user changes or picks it. A press is dropped
 * when the choices change while the lists load. Nothing is applied when the
 * lists cannot be loaded or the current choices already break a rule; a message says so.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;
  var MIN_CHOSEN = 2;
  var SETTINGS = ['modes', 'direction'];

  var els = {};
  var noteParts = null; // [key, params] of the last message, redrawn on a language switch
  var filling = false; // true while our own change is applied

  function note(key, params) {
    noteParts = key ? [key, params] : null;
    els.note.textContent = key ? t(key, params) : '';
  }

  // Settings (mode, direction) say nothing about style: with only those, there is nothing to match against.
  function styleChosen(chosen) {
    return chosen.filter(function (e) {
      return SETTINGS.indexOf(e) === -1;
    }).length;
  }

  function render() {
    var total = H.resolve.ELEMENTS.length;
    var list = H.state.chosen();
    var chosen = list.length;
    els.box.hidden = chosen < MIN_CHOSEN || chosen === total || styleChosen(list) === 0;
    els.lead.textContent = t('autofill.lead', { chosen: chosen, total: total });
  }

  // The «Filled automatically» mark on each filled element of the advanced list.
  function mark() {
    var auto = H.state.identity().autoFilled;
    Array.prototype.forEach.call(document.querySelectorAll('#element-list [data-element]'), function (li) {
      var toggle = li.querySelector('.g-toggle');
      if (!toggle) return;
      var badge = toggle.querySelector('[data-auto-filled]');
      if (auto.indexOf(li.getAttribute('data-element')) === -1) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'g-auto';
        badge.setAttribute('data-auto-filled', 'true');
        badge.setAttribute('data-i18n', 'autofill.mark');
        toggle.appendChild(badge);
      }
      badge.textContent = t('autofill.mark');
    });
  }

  function apply() {
    var out = H.autofill.fill(H.state.choices(), H.state.chosen(), H.library.view(), H.session || null);
    if (!out.allowed) return note('autofill.refused');
    filling = true;
    var ok = H.state.change(function (c) {
      Object.keys(c).forEach(function (k) {
        delete c[k];
      });
      Object.keys(out.choices).forEach(function (k) {
        c[k] = out.choices[k];
      });
    }, 'auto');
    filling = false;
    if (ok) note('autofill.done', { count: out.filled.length });
    else note('autofill.refused');
  }

  // What the press was for: if the choices change while the lists load, the press no longer applies.
  function snapshot() {
    return JSON.stringify([H.state.choices(), H.state.chosen()]);
  }

  function onPress() {
    els.button.disabled = true;
    note('autofill.loading');
    var pressed = snapshot();
    // Every element's full list, so the same choices always give the same result.
    Promise.all(H.resolve.ELEMENTS.map(H.library.load)).then(
      function () {
        els.button.disabled = false;
        if (snapshot() !== pressed || els.box.hidden) return note(null);
        apply();
      },
      function () {
        els.button.disabled = false;
        note('autofill.failed');
      }
    );
  }

  function init() {
    els.box = document.getElementById('autofill');
    els.lead = document.getElementById('autofill-lead');
    els.button = document.getElementById('autofill-btn');
    els.note = document.getElementById('autofill-note');
    if (!els.box || !H.autofill) return;
    els.button.addEventListener('click', onPress);
    document.addEventListener('hawiya:state', function () {
      if (!filling) note(null); // another change: the last message no longer describes the page
      render();
      mark();
    });
    document.addEventListener('hawiya:lang', function () {
      if (noteParts) els.note.textContent = t(noteParts[0], noteParts[1]);
      render();
      mark();
    });
    render();
    mark();
  }

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
