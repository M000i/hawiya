/*
 * Guided mode (task 2.19, R-021 / R-022 / AC-15). Browser: loads after state.js, library.js, rules.js, match.js,
 * autofill.js and the element parts (settings.js).
 *
 * Eight questions, one at a time and in this order: the overall character, the primary color, the font (only
 * those that support the project language), the corners, the density, the icons, the motion level, and the
 * language with its numerals and calendar. The last three are simple choices without a gallery. Every answer is
 * applied at once (the preview follows) and everything not answered is derived from the answers so far
 * (H.autofill.fill, steered by the character's tags and the session's), within the blocking rules. The advanced
 * mode can be opened at any moment; the answers stay.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var t = H.i18n.t;

  // The character steers everything that is derived (two of the library's fixed tags each).
  var MOODS = [
    { id: 'calm', key: 'guided.mood.calm', tags: ['corporate', 'minimal'] },
    { id: 'friendly', key: 'guided.mood.friendly', tags: ['soft', 'playful'] },
    { id: 'technical', key: 'guided.mood.technical', tags: ['technical', 'data-dense'] },
    { id: 'editorial', key: 'guided.mood.editorial', tags: ['editorial', 'vivid'] }
  ];
  var MOTION = [
    { id: 'none', key: 'guided.motion.none' },
    { id: 'subtle', key: 'guided.motion.subtle' },
    { id: 'medium', key: 'guided.motion.medium' },
    { id: 'strong', key: 'guided.motion.strong' }
  ];
  var NUMERALS = [
    { id: 'latn', key: 'direction.numerals.latn' },
    { id: 'arab', key: 'direction.numerals.arab' }
  ];
  var CALENDARS = [
    { id: 'gregory', key: 'direction.calendar.gregory' },
    { id: 'islamic-umalqura', key: 'direction.calendar.islamic' }
  ];
  var STEPS = [
    { id: 'mood', key: 'guided.q.mood', hint: { key: 'guided.h.mood' } },
    { id: 'colors', element: 'colors', key: 'guided.q.colors', hint: { key: 'guided.h.colors' } },
    { id: 'fonts', element: 'fonts', key: 'guided.q.fonts', hint: { key: 'guided.h.fonts' } },
    { id: 'radius', element: 'radius', key: 'guided.q.radius', hint: { key: 'guided.h.radius' } },
    { id: 'spacing', element: 'spacing', key: 'guided.q.spacing', hint: { key: 'guided.h.spacing' } },
    { id: 'icons', element: 'icons', key: 'guided.q.icons', hint: { key: 'guided.h.icons' } },
    { id: 'motion', key: 'guided.q.motion', hint: { key: 'guided.h.motion' } },
    { id: 'language', key: 'guided.q.language', hint: { key: 'guided.h.language' } }
  ];

  var els = {};
  var step = 0; // index in STEPS; STEPS.length = finished
  var mood = null;
  var noteParts = null;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function nameOf(tpl) {
    var lang = H.i18n.lang();
    return (tpl.name && (tpl.name[lang] || tpl.name.ar)) || tpl.id;
  }

  function note(key, params) {
    noteParts = key ? [key, params] : null;
    els.note.textContent = key ? t(key, params) : '';
  }

  // The tags that steer what is derived: the character's, then the session's (R-033).
  function tags() {
    var out = [];
    MOODS.forEach(function (m) {
      if (m.id === mood) out = out.concat(m.tags);
    });
    if (H.session && Array.isArray(H.session.tags)) out = out.concat(H.session.tags);
    return out;
  }

  /* ---------- applying answers ---------- */

  // Everything the user has not chosen is derived again from the answers so far.
  function derive() {
    var out = H.autofill.fill(H.state.choices(), H.state.chosen(), H.library.view(), { tags: tags() });
    if (!out.allowed) return;
    H.state.change(function (c) {
      Object.keys(c).forEach(function (k) {
        delete c[k];
      });
      Object.keys(out.choices).forEach(function (k) {
        c[k] = out.choices[k];
      });
    }, 'auto');
  }

  function answerTemplate(element, id) {
    var ok = H.state.change(
      function (c) {
        c.selections[element] = { template: id };
      },
      [element]
    );
    if (ok) derive();
  }

  function answerColor(hex) {
    var ok = H.state.change(
      function (c) {
        var s = c.selections.colors;
        var tpl = H.library.find('colors', s.template);
        var own = tpl.tokens.color.primary.$value.hex.toLowerCase();
        var ov = s.overrides || {};
        if (hex.toLowerCase() === own) delete ov.primary;
        else ov.primary = hex.toLowerCase();
        if (Object.keys(ov).length) s.overrides = ov;
        else delete s.overrides;
      },
      ['colors']
    );
    if (ok) derive();
  }

  function answerMotion(level) {
    H.state.change(function (c) {
      c.motion = level;
    });
  }

  // A font the new language cannot use is replaced by the best one that can, in the same change.
  function answerDirection(id) {
    var tpl = H.library.find('direction', id);
    if (!tpl) return;
    var trial = H.state.choices();
    var pick = H.galleryParts && H.galleryParts.direction && H.galleryParts.direction.pick;
    if (pick) pick(trial, tpl);
    else trial.selections.direction = { template: id };
    var project;
    try {
      project = H.resolve.resolve(trial, H.library.view()).project;
    } catch (e) {
      return;
    }
    var font = H.library.find('fonts', trial.selections.fonts.template);
    var replaced = null;
    if (font && !H.rules.allowed(font, project)) {
      replaced = H.match.best(
        'fonts',
        H.library.view().templates.fonts,
        trial.selections,
        H.library.find,
        { tags: tags() },
        function (f) {
          return H.rules.allowed(f, project);
        }
      );
      if (!replaced) return;
      trial.selections.fonts = { template: replaced };
    }
    var ok = H.state.change(
      function (c) {
        c.selections = trial.selections;
      },
      ['direction']
    );
    if (!ok) return;
    if (replaced) note('guided.fontChanged', { font: nameOf(H.library.find('fonts', replaced)) });
    derive();
  }

  function answerDirectionSetting(name, value) {
    H.state.change(
      function (c) {
        var s = c.selections.direction;
        var tpl = H.library.find('direction', s.template);
        var own = tpl && tpl.extras ? tpl.extras[name] : null;
        var ov = s.overrides || {};
        if (value === own) delete ov[name];
        else ov[name] = value;
        if (Object.keys(ov).length) s.overrides = ov;
        else delete s.overrides;
      },
      ['direction']
    );
  }

  /* ---------- drawing ---------- */

  function option(text, attr, value, onPick) {
    var b = el('button', 'gd-option');
    b.type = 'button';
    b.setAttribute(attr, value);
    b.setAttribute('aria-pressed', 'false');
    b.textContent = text;
    b.addEventListener('click', function () {
      note(null);
      onPick(value);
    });
    return b;
  }

  // label: { key } of the group's title, or null.
  function group(label, children) {
    var box = el('div', 'gd-group');
    box.setAttribute('role', 'group');
    if (label) {
      var p = el('p', 'gd-label');
      p.textContent = t(label.key);
      box.appendChild(p);
      box.setAttribute('aria-label', t(label.key));
    }
    var list = el('div', 'gd-options');
    children.forEach(function (c) {
      list.appendChild(c);
    });
    box.appendChild(list);
    return box;
  }

  function templateOptions(element, keep) {
    return H.library
      .view()
      .templates[element].filter(keep || Boolean)
      .map(function (tpl) {
        return option(nameOf(tpl), 'data-guided-template', tpl.id, function (id) {
          answerTemplate(element, id);
        });
      });
  }

  function drawOptions(s) {
    var box = els.options;
    box.textContent = '';
    if (s.id === 'mood') {
      box.appendChild(
        group(
          null,
          MOODS.map(function (m) {
            return option(t(m.key), 'data-guided-mood', m.id, function (id) {
              mood = id;
              derive();
              sync();
            });
          })
        )
      );
    } else if (s.id === 'colors') {
      box.appendChild(group(null, templateOptions('colors')));
      var label = el('label', 'gd-color');
      var span = el('span');
      span.textContent = t('guided.customColor');
      var input = el('input');
      input.type = 'color';
      input.setAttribute('data-guided-color', 'true');
      input.addEventListener('change', function () {
        note(null);
        answerColor(input.value);
      });
      label.appendChild(span);
      label.appendChild(input);
      box.appendChild(label);
    } else if (s.id === 'fonts') {
      var project = H.state.identity().project;
      box.appendChild(
        group(
          null,
          templateOptions('fonts', function (f) {
            return H.rules.allowed(f, project);
          })
        )
      );
    } else if (s.element) {
      box.appendChild(group(null, templateOptions(s.element)));
    } else if (s.id === 'motion') {
      box.appendChild(
        group(
          null,
          MOTION.map(function (m) {
            return option(t(m.key), 'data-guided-motion', m.id, answerMotion);
          })
        )
      );
    } else if (s.id === 'language') {
      box.appendChild(
        group(
          { key: 'guided.languageLabel' },
          H.library.view().templates.direction.map(function (tpl) {
            return option(nameOf(tpl), 'data-guided-direction', tpl.id, answerDirection);
          })
        )
      );
      box.appendChild(
        group(
          { key: 'direction.numerals.label' },
          NUMERALS.map(function (n) {
            return option(t(n.key), 'data-guided-numerals', n.id, function (v) {
              answerDirectionSetting('numerals', v);
            });
          })
        )
      );
      box.appendChild(
        group(
          { key: 'direction.calendar.label' },
          CALENDARS.map(function (n) {
            return option(t(n.key), 'data-guided-calendar', n.id, function (v) {
              answerDirectionSetting('calendar', v);
            });
          })
        )
      );
    }
  }

  // Mark the current answers (after every change, without redrawing, so the focus stays where it is).
  function sync() {
    if (!els.options) return;
    var c = H.state.choices();
    var id = H.state.identity();
    var s = STEPS[step];
    function press(attr, current) {
      Array.prototype.forEach.call(els.options.querySelectorAll('[' + attr + ']'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute(attr) === current));
      });
    }
    press('data-guided-mood', mood);
    if (s && s.element) press('data-guided-template', c.selections[s.element].template);
    press('data-guided-motion', id.extensions.motion);
    press('data-guided-direction', c.selections.direction.template);
    press('data-guided-numerals', id.extensions.numerals);
    press('data-guided-calendar', id.extensions.calendar);
    var color = els.options.querySelector('[data-guided-color]');
    if (color && color !== document.activeElement) color.value = id.tokens.color.light.primary;
  }

  function draw(focus) {
    var done = step >= STEPS.length;
    els.question.hidden = done;
    els.done.hidden = !done;
    els.back.disabled = step === 0;
    els.next.hidden = done;
    if (done) {
      els.progress.textContent = '';
      els.options.textContent = '';
      els.done.textContent = t('guided.done');
      if (focus) els.done.focus();
      return;
    }
    var s = STEPS[step];
    els.progress.textContent = t('guided.progress', { n: step + 1, total: STEPS.length });
    els.heading.textContent = t(s.key);
    els.hint.textContent = t(s.hint.key);
    var text = step === STEPS.length - 1 ? t('guided.finish') : t('guided.next');
    els.next.textContent = text;
    els.question.setAttribute('data-guided-step', s.id);
    drawOptions(s);
    sync();
    if (focus) els.heading.focus();
  }

  function go(to) {
    step = Math.max(0, Math.min(STEPS.length, to));
    note(null);
    draw(true);
  }

  function start() {
    els.start.disabled = true;
    note('guided.loading');
    // Every element's full list: the questions offer all of it and the derivation needs all of it.
    Promise.all(H.resolve.ELEMENTS.map(H.library.load)).then(
      function () {
        els.start.disabled = false;
        els.start.hidden = true;
        els.body.hidden = false;
        note(null);
        // The questions start over: only their answers count as the user's; the rest is derived from them.
        H.state.forget();
        go(0);
      },
      function () {
        els.start.disabled = false;
        note('guided.loadFailed');
      }
    );
  }

  function toAdvanced() {
    var title = document.getElementById('advanced-title');
    if (!title) return;
    title.setAttribute('tabindex', '-1');
    title.scrollIntoView({ block: 'start' });
    title.focus();
  }

  function init() {
    els.box = document.getElementById('guided');
    if (!els.box || !H.autofill) return;
    els.start = document.getElementById('guided-start');
    els.body = document.getElementById('guided-body');
    els.progress = document.getElementById('guided-progress');
    els.question = document.getElementById('guided-question');
    els.heading = document.getElementById('guided-heading');
    els.hint = document.getElementById('guided-hint');
    els.options = document.getElementById('guided-options');
    els.done = document.getElementById('guided-done');
    els.back = document.getElementById('guided-back');
    els.next = document.getElementById('guided-next');
    els.note = document.getElementById('guided-note');
    els.start.addEventListener('click', start);
    els.back.addEventListener('click', function () {
      go(step - 1);
    });
    els.next.addEventListener('click', function () {
      go(step + 1);
    });
    document.getElementById('guided-advanced').addEventListener('click', toAdvanced);
    document.addEventListener('hawiya:state', sync);
    document.addEventListener('hawiya:refused', sync);
    document.addEventListener('hawiya:lang', function () {
      if (!els.body.hidden) draw(false);
      if (noteParts) els.note.textContent = t(noteParts[0], noteParts[1]);
    });
  }

  H.guided = {
    // For the page's own checks: the step shown (0-based; 8 = finished) and the character chosen.
    status: function () {
      return { step: step, mood: mood };
    }
  };

  function boot() {
    H.state.whenReady(init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
