'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const generate = require('../picker/js/core/generate.js');

const LINT_BIN = path.join(__dirname, '..', 'node_modules', '@google', 'design.md', 'dist', 'index.js');

function lint(markdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-lint-'));
  const file = path.join(dir, 'DESIGN.md');
  fs.writeFileSync(file, markdown);
  try {
    const out = execFileSync(process.execPath, [LINT_BIN, 'lint', '--format', 'json', file], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = { name: 'مؤسسي هادئ', primary: '#2563eb', fontFamily: 'IBM Plex Sans Arabic', radius: 8 };

// Linted cases: the 5 swatches, the 3 fonts, radius extremes, plus custom-picker colors chosen to be
// hard: very light, mid-luminance (where neither black nor white text is comfortable), and the
// counterexamples found in review (#ff0000, #0582c3, #7b7b7b, #006eff, #767676, #777777).
// The full color space is covered by the sweep test further below.
const CASES = [
  BASE,
  { ...BASE, primary: '#0f766e' },
  { ...BASE, primary: '#7c3aed' },
  { ...BASE, primary: '#b91c1c' },
  { ...BASE, primary: '#1f2937' },
  { ...BASE, primary: '#facc15' },
  { ...BASE, primary: '#ffffff' },
  { ...BASE, primary: '#000000' },
  { ...BASE, primary: '#ff0000' },
  { ...BASE, primary: '#0582c3' },
  { ...BASE, primary: '#7b7b7b' },
  { ...BASE, primary: '#006eff' },
  { ...BASE, primary: '#767676' },
  { ...BASE, primary: '#777777' },
  { ...BASE, fontFamily: 'Cairo' },
  { ...BASE, fontFamily: 'Tajawal' },
  { ...BASE, radius: 0 },
  { ...BASE, radius: 24 },
  { ...BASE, name: 'اسم: فيه "علامات" و#رموز\nوسطر جديد' }
];

for (const input of CASES) {
  const label = `${input.primary} / ${input.fontFamily} / ${input.radius}px / ${JSON.stringify(input.name)}`;

  test(`DESIGN.md passes official lint with 0 errors and 0 warnings: ${label}`, () => {
    const files = generate(input);
    const report = lint(files['DESIGN.md']);
    const problems = report.findings.filter((f) => f.severity !== 'info');
    assert.deepEqual(problems, [], JSON.stringify(problems, null, 2));
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });

  test(`identity.json is valid JSON and carries the choices: ${label}`, () => {
    const files = generate(input);
    const identity = JSON.parse(files['identity.json']);
    assert.equal(identity.tokens.color.primary, input.primary.toLowerCase());
    assert.equal(identity.tokens.font.family, input.fontFamily);
    assert.equal(identity.tokens.radius.md, input.radius);
    assert.equal(identity.project.direction, 'rtl');
  });
}

test('DESIGN.md frontmatter carries the chosen values', () => {
  const md = generate(BASE)['DESIGN.md'];
  assert.match(md, /^---\n/);
  assert.match(md, /\n {2}primary: "#2563eb"\n/);
  assert.match(md, /fontFamily: "IBM Plex Sans Arabic"/);
  assert.match(md, /\n {2}md: "8px"\n/);
});

test('generator is deterministic: same input gives byte-identical files', () => {
  const a = generate(BASE);
  const b = generate({ ...BASE });
  assert.deepEqual(Object.keys(a).sort(), ['DESIGN.md', 'identity.json']);
  assert.equal(a['DESIGN.md'], b['DESIGN.md']);
  assert.equal(a['identity.json'], b['identity.json']);
});

// Independent WCAG 2.x contrast, written separately from the generator on purpose.
function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex2 = (n) => n.toString(16).padStart(2, '0');

test('sweep of 4,913 colors across sRGB: on-primary and accent text always reach WCAG AA (4.5:1)', () => {
  const steps = [];
  for (let c = 0; c <= 255; c += 16) steps.push(c);
  steps.push(255);
  let checked = 0;
  let worst = { ratio: Infinity };
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const primary = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    const d = generate.derive({ ...BASE, primary });
    const onPrimary = ratio(primary, d.onPrimary);
    const accent = ratio(d.accentText, '#ffffff');
    if (onPrimary < worst.ratio) worst = { primary, ratio: onPrimary };
    assert.ok(onPrimary >= 4.5, `on-primary ${d.onPrimary} on ${primary} = ${onPrimary.toFixed(3)}`);
    assert.ok(accent >= 4.5, `accent ${d.accentText} on #ffffff = ${accent.toFixed(3)}`);
    checked++;
  }
  assert.equal(checked, 17 ** 3);
  assert.ok(worst.ratio >= 4.58, `worst ${worst.primary} ${worst.ratio}`);
});

test('accent text uses primary only when primary itself reaches AA on the white surface', () => {
  assert.equal(generate.derive({ ...BASE, primary: '#2563eb' }).accentText, '#2563eb');
  assert.equal(generate.derive({ ...BASE, primary: '#facc15' }).accentText, '#111827');
  const md = generate({ ...BASE, primary: '#facc15' })['DESIGN.md'];
  assert.match(md, /button-secondary:\n {4}backgroundColor: "\{colors.surface\}"\n {4}textColor: "\{colors.on-surface\}"/);
  assert.match(md, /too light for text on surface/);
});

test('name: long names are cut on whole characters, bidi controls and lone surrogates removed', () => {
  const longEmoji = generate.derive({ ...BASE, name: 'x'.repeat(79) + '😀😀' }).name;
  assert.equal(Array.from(longEmoji).length, 80);
  assert.ok(longEmoji.endsWith('😀'));
  assert.doesNotMatch(longEmoji, /[\ud800-\udbff](?![\udc00-\udfff])/);

  const bidi = generate.derive({ ...BASE, name: 'هوية\u202Eخبيثة\u2066x\u2069\u061C' }).name;
  assert.equal(bidi, 'هويةخبيثةx');

  const lone = generate.derive({ ...BASE, name: 'a\ud83db' }).name;
  assert.equal(lone, 'ab');

  assert.equal(generate.derive({ ...BASE, name: '\u202E\u200F  ' }).name, 'Hawiya identity');
});

test('no left/right physical properties or Arabic-hostile typography in output', () => {
  const md = generate(BASE)['DESIGN.md'];
  assert.doesNotMatch(md, /letterSpacing/);
  assert.doesNotMatch(md, /\b(margin|padding)-(left|right)\b/);
});

test('rejects invalid input instead of producing a broken file', () => {
  assert.throws(() => generate({ ...BASE, primary: 'blue' }), /primary/);
  assert.throws(() => generate({ ...BASE, primary: '#12345' }), /primary/);
  assert.throws(() => generate({ ...BASE, radius: -2 }), /radius/);
  assert.throws(() => generate({ ...BASE, radius: 7.5 }), /radius/);
  assert.throws(() => generate({ ...BASE, radius: 500 }), /radius/);
  assert.throws(() => generate({ ...BASE, fontFamily: '' }), /fontFamily/);
  assert.throws(() => generate({ ...BASE, fontFamily: 'Evil"\n---' }), /fontFamily/);
  assert.throws(() => generate(null), /input/);
});
