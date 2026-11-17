'use strict';
// The first 37 reviewed templates (tasks 1.x to 2.x) and the two identities made from them. Tests whose expected
// values were computed by hand on that library (autofill, match) run on it, so the hand computations stay true now
// that the library holds about 280 templates (task 3.14).
const FIRST = {
  colors: ['palette-blue', 'palette-teal', 'palette-rose'],
  modes: ['modes-system', 'modes-light-first', 'modes-dark-first'],
  fonts: [
    'pair-plex-arabic-plex-sans',
    'pair-noto-sans-arabic-noto-sans',
    'pair-cairo',
    'font-noto-kufi-arabic',
    'font-inter'
  ],
  'type-scale': ['scale-minor-third', 'scale-major-third', 'scale-perfect-fourth'],
  radius: ['radius-sharp', 'radius-medium', 'radius-round'],
  shadows: ['shadow-flat', 'shadow-soft', 'shadow-deep'],
  icons: [
    'icons-lucide-outline',
    'icons-lucide-light',
    'icons-phosphor-regular',
    'icons-phosphor-bold',
    'icons-tabler-outline'
  ],
  buttons: ['button-solid', 'button-outline', 'button-soft'],
  cards: ['card-bordered', 'card-elevated', 'card-filled'],
  spacing: ['spacing-compact', 'spacing-comfortable', 'spacing-airy'],
  direction: ['direction-rtl', 'direction-ltr', 'direction-both']
};
const FIRST_IDENTITIES = ['calm-corporate', 'warm-friendly'];

// data (build.select(...).data) cut down to the first library, in its own file order.
function firstLibrary(data) {
  const templates = {};
  for (const [e, ids] of Object.entries(FIRST)) {
    templates[e] = data.templates[e].filter((t) => ids.includes(t.id));
    if (templates[e].length !== ids.length) throw new Error(`${e}: a template of the first library is missing`);
  }
  return { ...data, templates, identities: data.identities.filter((i) => FIRST_IDENTITIES.includes(i.id)) };
}

module.exports = { FIRST, firstLibrary };

// A copy of the picker page whose data is the first library (made once per test process), for the browser tests
// written on it: returns the file:// address of its index.html. The page code is the real one.
let firstPage = null;
function firstPickerPage() {
  if (firstPage) return firstPage;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { pathToFileURL } = require('url');
  const build = require('../../tools/build.js');
  const ROOT = path.join(__dirname, '..', '..');
  const data = build.select(build.load(path.join(ROOT, 'library'))).data;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-first-'));
  fs.cpSync(path.join(ROOT, 'picker'), dir, { recursive: true });
  for (const [name, text] of Object.entries(build.render(firstLibrary(data))))
    fs.writeFileSync(path.join(dir, 'data', name), text);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  firstPage = pathToFileURL(path.join(dir, 'index.html')).href;
  return firstPage;
}

module.exports.firstPickerPage = firstPickerPage;
