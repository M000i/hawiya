/*
 * Interface language (task 2.3, R-032). Load picker/i18n/ar.js and en.js first.
 * Browser: window.Hawiya.i18n.
 *
 *   t(key [, params])   text for the current language; {name} placeholders are filled from params
 *   lang()              'ar' or 'en'
 *   setLang(lang)       switches every text, <html lang/dir> and the title, then fires 'hawiya:lang'
 *   apply(root)         fills elements under root:
 *                         data-i18n="key"                        -> textContent
 *                         data-i18n-attr="aria-label:key;title:key" -> attributes
 *
 * The choice is remembered in localStorage when the browser allows it; Arabic is the default.
 * Text is only ever written with textContent / setAttribute, never as HTML.
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var DATA = H.i18nData || {};
  var LANGS = { ar: 'rtl', en: 'ltr' };
  var STORE_KEY = 'hawiya.lang';
  var current = 'ar';

  function readStored() {
    try {
      var v = window.localStorage.getItem(STORE_KEY);
      return Object.prototype.hasOwnProperty.call(LANGS, v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function store(lang) {
    try {
      window.localStorage.setItem(STORE_KEY, lang);
    } catch (e) {
      /* private mode or blocked storage: the choice simply is not remembered */
    }
  }

  function t(key, params) {
    var dict = DATA[current] || {};
    if (!Object.prototype.hasOwnProperty.call(dict, key)) {
      if (window.console) console.error('hawiya i18n: missing key ' + key + ' (' + current + ')');
      return key;
    }
    return dict[key].replace(/\{([a-zA-Z]+)\}/g, function (all, name) {
      return params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : all;
    });
  }

  function apply(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-attr]'), function (el) {
      el.getAttribute('data-i18n-attr')
        .split(';')
        .forEach(function (pair) {
          var at = pair.indexOf(':');
          if (at > 0) el.setAttribute(pair.slice(0, at).trim(), t(pair.slice(at + 1).trim()));
        });
    });
  }

  function other() {
    return current === 'ar' ? 'en' : 'ar';
  }

  function render() {
    var html = document.documentElement;
    html.lang = current;
    html.dir = LANGS[current];
    document.title = t('app.title');
    apply(document);
    var toggle = document.getElementById('lang-toggle');
    // The button names the other language in that language.
    if (toggle) toggle.setAttribute('lang', other());
  }

  function setLang(lang) {
    if (!Object.prototype.hasOwnProperty.call(LANGS, lang) || !DATA[lang]) return;
    current = lang;
    store(lang);
    render();
    document.dispatchEvent(new CustomEvent('hawiya:lang', { detail: { lang: lang } }));
  }

  H.i18n = {
    t: t,
    apply: apply,
    setLang: setLang,
    lang: function () {
      return current;
    }
  };

  current = readStored() || 'ar';
  render();

  function init() {
    var toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        setLang(other());
      });
    }
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
