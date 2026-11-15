'use strict';
// Task 2.6: the preview gets exactly the CSS variables tokens.css holds, and the scene text exists in both languages.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

const generate = require('../picker/js/core/generate.js');
const resolve = require('../picker/js/core/resolve.js');
const build = require('../tools/build.js');

const DATA = build.select(build.load(path.join(__dirname, '..', 'library'))).data;

function ready(id) {
  const r = DATA.identities.find((i) => i.id === id);
  const selections = {};
  for (const e of resolve.ELEMENTS) selections[e] = { template: r.templates[e] };
  return resolve.resolve({ name: r.name.ar, selections }, DATA);
}

test('cssVariables gives, for each mode, exactly the declarations tokens.css makes for that mode', () => {
  for (const name of ['calm-corporate', 'warm-friendly']) {
    const id = ready(name);
    const css = generate.valueFiles(id)['tokens.css'];
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    const forced = css.slice(css.lastIndexOf('{', css.lastIndexOf('}')), css.lastIndexOf('}'));
    const declared = (block) => new Map([...block.matchAll(/^\s*(--[a-z0-9-]+): (.+);$/gm)].map((m) => [m[1], m[2]]));
    const light = new Map(generate.cssVariables(id, 'light'));
    const dark = new Map(generate.cssVariables(id, 'dark'));
    assert.deepEqual(light, declared(root), `${name} light`);
    // Dark: the forced-dark block overrides colors and shadows; everything else is inherited from :root.
    const darkExpected = new Map([...declared(root), ...declared(forced)]);
    assert.deepEqual(dark, darkExpected, `${name} dark`);
    assert.notEqual(light.get('--color-background'), dark.get('--color-background'));
  }
  assert.throws(() => generate.cssVariables(ready('calm-corporate'), 'dim'), /mode must be light or dark/);
});

for (const name of ['landing', 'dashboard', 'form', 'mobile']) {
  test(`the ${name} scene has the same sample text structure in Arabic and English, text-only DOM, logical CSS`, () => {
    const file = path.join(__dirname, '..', `picker/scenes/${name}.js`);
    const ctx = { self: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
    const scene = ctx.self.Hawiya.scenes[name];
    const T = scene.text;
    const shape = (o) => JSON.stringify(o, (k, v) => (typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : v));
    assert.equal(shape(T.en), shape(T.ar));
    assert.match(JSON.stringify(T.ar), /[\u0600-\u06FF]/);
    assert.doesNotMatch(JSON.stringify(T.en), /[\u0600-\u06FF]/);
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    assert.doesNotMatch(
      scene.css,
      /(margin|padding|border|inset)-(left|right)|text-align:\s*(left|right)|(^|[\s;{])(left|right):|float:\s*(left|right)/
    );
    // Only the identity's variables (and the scene sizes the engine sets) are used.
    const known = new Set(
      generate
        .cssVariables(ready('calm-corporate'), 'light')
        .map((p) => p[0])
        .concat(['--sc-small', '--sc-body', '--sc-h3', '--sc-h2', '--sc-h1'])
    );
    for (const m of scene.css.matchAll(/var\((--[a-z0-9-]+)\)/g)) assert.ok(known.has(m[1]), `${name}: ${m[1]}`);
  });
}
