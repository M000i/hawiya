/*
 * The library as the page sees it (task 2.9). Browser: window.Hawiya.library.
 * The page starts with picker/data/starter.js (the templates the ready identities use) and identities.js.
 * An element's full file (picker/data/<element>.js) is loaded the first time it is needed: when its gallery is
 * opened, or when the current or a saved identity uses a template that is not in the starter set.
 *
 *   library.view()               { templates: { <element>: [...] } } for resolve.resolve: the full list of an element
 *                                once loaded, else its starter templates
 *   library.find(element, id)    the template, or null
 *   library.isLoaded(element)    true once its full file is in
 *   library.load(element)        Promise, resolves when the full file is in (loaded once; never twice)
 *   library.ensure(selections)   Promise for every element whose chosen template is not available yet; resolves
 *                                synchronously-fast (already settled) when nothing is missing
 *   library.missing(selections)  the elements ensure() would load
 */
(function () {
  'use strict';

  var H = (window.Hawiya = window.Hawiya || {});
  var ELEMENTS = [
    'colors',
    'modes',
    'fonts',
    'type-scale',
    'radius',
    'shadows',
    'icons',
    'buttons',
    'cards',
    'spacing',
    'direction'
  ];
  var ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  var pending = {};

  function data() {
    return H.data || {};
  }

  function isLoaded(element) {
    var t = data().templates;
    return !!(t && Object.prototype.hasOwnProperty.call(t, element));
  }

  function list(element) {
    if (isLoaded(element)) return data().templates[element];
    var s = data().starter;
    return (s && s[element]) || [];
  }

  function view() {
    var templates = {};
    ELEMENTS.forEach(function (e) {
      templates[e] = list(e);
    });
    return { templates: templates };
  }

  function find(element, id) {
    var l = list(element);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function load(element) {
    if (ELEMENTS.indexOf(element) === -1) return Promise.reject(new Error('unknown element ' + element));
    if (isLoaded(element)) return Promise.resolve();
    if (pending[element]) return pending[element];
    pending[element] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'data/' + element + '.js'; // a fixed name from the list above, never from data or the URL
      s.setAttribute('data-element', element);
      s.onload = function () {
        if (isLoaded(element)) resolve();
        else reject(new Error('data/' + element + '.js did not register its templates'));
      };
      s.onerror = function () {
        delete pending[element];
        s.parentNode.removeChild(s);
        reject(new Error('cannot load data/' + element + '.js'));
      };
      document.head.appendChild(s);
    });
    return pending[element];
  }

  function missing(selections) {
    var out = [];
    ELEMENTS.forEach(function (e) {
      var s = selections && selections[e];
      var id = s && typeof s.template === 'string' ? s.template : null;
      if (id && ID.test(id) && !isLoaded(e) && !find(e, id)) out.push(e);
    });
    return out;
  }

  function ensure(selections) {
    return Promise.all(missing(selections).map(load));
  }

  H.library = {
    view: view,
    find: find,
    isLoaded: isLoaded,
    load: load,
    ensure: ensure,
    missing: missing,
    ELEMENTS: ELEMENTS
  };
})();
