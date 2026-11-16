/*
 * What a button or card recipe may contain (gate 2, after review). Browser: window.Hawiya.recipe; Node: require.
 * Used by tools/build.js (a recipe that breaks it is never published), rules.js (blocked like any rule) and the
 * page (preview.js rebuilds the HTML from the same allow-list, so a recipe is never inserted as markup).
 *
 *   check(recipe) → [problem]   { where: 'html' | 'css', what } ; [] when the recipe may be drawn
 *   TAGS, isAttribute(name)     the allow-list
 *
 * HTML: only the tags and attributes below, attribute values in double quotes without < > & or quotes, no comments,
 *   no <style> or <script>, no inline style, no event handlers, no links or images. Text may hold {placeholders}.
 * CSS: no backslash escapes (they can spell any word), no url( / image-set( / @import / @namespace (no request to
 *   any host: the page's only outside request is Google Fonts), no :host (a recipe never styles the page around
 *   it), no expression( / javascript: / behavior / -moz-binding.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Hawiya = root.Hawiya || {}).recipe = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAGS = [
    'article',
    'aside',
    'br',
    'button',
    'div',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'input',
    'label',
    'li',
    'nav',
    'ol',
    'p',
    'section',
    'small',
    'span',
    'strong',
    'ul'
  ];
  var ATTRS = ['class', 'type', 'role', 'dir', 'lang', 'placeholder', 'disabled', 'value', 'name', 'for'];
  var MAX_HTML = 20000;

  function isTag(name) {
    return TAGS.indexOf(name) !== -1;
  }

  function isAttribute(name) {
    return ATTRS.indexOf(name) !== -1 || /^aria-[a-z]+$/.test(name);
  }

  var CLOSE = /^<\/([a-z][a-z0-9]*)\s*>/;
  var OPEN = /^<([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"<>&]*")?)*)\s*\/?>/;
  var ATTR = /\s+([a-z][a-z0-9-]*)(?:="([^"<>&]*)")?/g;
  var TEXT = /^[^<]+/;

  function checkHtml(html) {
    var out = [];
    if (typeof html !== 'string' || html.length > MAX_HTML) return [{ where: 'html', what: 'not a short text' }];
    var rest = html;
    while (rest.length && out.length < 5) {
      var m;
      if ((m = TEXT.exec(rest))) {
        rest = rest.slice(m[0].length);
      } else if ((m = CLOSE.exec(rest))) {
        if (!isTag(m[1])) out.push({ where: 'html', what: 'tag <' + m[1] + '>' });
        rest = rest.slice(m[0].length);
      } else if ((m = OPEN.exec(rest))) {
        if (!isTag(m[1])) out.push({ where: 'html', what: 'tag <' + m[1] + '>' });
        var a;
        ATTR.lastIndex = 0;
        while ((a = ATTR.exec(m[2]))) {
          if (!isAttribute(a[1])) out.push({ where: 'html', what: 'attribute ' + a[1] });
        }
        rest = rest.slice(m[0].length);
      } else {
        out.push({ where: 'html', what: 'markup that is not a plain tag: ' + rest.slice(0, 20) });
        break;
      }
    }
    return out;
  }

  var CSS_FORBIDDEN = [
    [/\\/, 'backslash escape'],
    [/url\s*\(/i, 'url('],
    [/image-set\s*\(/i, 'image-set('],
    [/@import/i, '@import'],
    [/@namespace/i, '@namespace'],
    [/:host/i, ':host'],
    [/expression\s*\(/i, 'expression('],
    [/javascript\s*:/i, 'javascript:'],
    [/behavior\s*:/i, 'behavior'],
    [/-moz-binding/i, '-moz-binding'],
    [/<\//, '</']
  ];

  function checkCss(css) {
    if (typeof css !== 'string') return [{ where: 'css', what: 'not text' }];
    var out = [];
    CSS_FORBIDDEN.forEach(function (f) {
      if (f[0].test(css)) out.push({ where: 'css', what: f[1] });
    });
    return out;
  }

  function check(recipe) {
    if (!recipe || typeof recipe !== 'object') return [{ where: 'html', what: 'no recipe' }];
    return checkHtml(recipe.html).concat(checkCss(recipe.css));
  }

  return { TAGS: TAGS, isTag: isTag, isAttribute: isAttribute, check: check };
});
