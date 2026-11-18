'use strict';
/* global AbortSignal */ // Node 18+ has it; the project's list of Node globals (eslint.config.js) predates fetch timeouts

/*
 * library/font-faces.json from Google Fonts (task 6.1, R-104). For the developer only: the page, the check, the build
 * and the tests never reach the internet; this command does, to Google Fonts only.
 *
 *   npm run fonts                          library/font-faces.json
 *   node tools/font-faces.js --library <dir>
 *
 * Why: a size adjustment between the two families of a pair (R-090) only takes effect through the size-adjust
 * descriptor of the Latin family's @font-face rules, and a Google Fonts <link> cannot carry one. So the rules are
 * recorded once here, and the generator writes them into the exported CSS with the value (task 6.2, R-103).
 *
 * What it records: for the Latin family of every fonts template that pairs two different families (drafts too, so a
 * pair is ready before its review), the normal-style faces of the subsets latin-ext and latin, for each of the
 * weights 400, 600 and 700 that Google Fonts has (it answers 400 Bad Request for a weight a family lacks). Each face is
 * { weight, subset, unicodeRange, url }. The CSS is asked for with a current Chrome user agent, so Google answers with
 * woff2 files. Same answers from Google Fonts -> same bytes (no clock, families sorted, faces by weight then subset).
 * Anything unexpected (a failed request, a face without woff2, a file outside fonts.gstatic.com, a family without 400
 * or without the latin subset) stops the run and nothing is written; the result must pass the build's own schema.
 */

const fs = require('node:fs');
const path = require('node:path');
const build = require('./build.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = 'https://fonts.googleapis.com/css2';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

class FontFacesError extends Error {}

// The Latin families of a library folder that need @font-face rules, sorted.
function families(libraryDir) {
  // The record being replaced is not read: a bad or outdated one must not stop its own repair.
  const lib = build.load(libraryDir, { fontFaces: false });
  return [...new Set(lib.templates.fonts.map(build.adjustableLatin).filter(Boolean))].sort();
}

function requestUrl(family, weight) {
  return `${SOURCE}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}&display=swap`;
}

// One Google Fonts CSS answer -> the faces of `family` at `weight` for the recorded subsets. Every @font-face block
// must follow a /* subset */ comment and name its style, as Google writes them; other subsets and styles are left
// out. A block without its comment or style stops the run, so a change in Google's format never drops a face unseen.
function parse(css, family, weight) {
  const faces = [];
  const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  let blocks = 0;
  while ((m = re.exec(css))) {
    blocks++;
    const subset = m[1];
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    const name = (decls['font-family'] || '').replace(/^['"]|['"]$/g, '');
    if (name !== family) throw new FontFacesError(`${family} ${weight}: a face of "${name}" in the answer`);
    if (!decls['font-style']) throw new FontFacesError(`${family} ${weight}: the ${subset} face names no font-style`);
    if (decls['font-style'] !== 'normal' || !build.FONT_FACE_SUBSETS.includes(subset)) continue;
    if (decls['font-weight'] !== String(weight))
      throw new FontFacesError(`${family} ${weight}: a ${subset} face has weight ${decls['font-weight']}`);
    const src = /^url\(([^)\s]+)\) format\('woff2'\)$/.exec(decls.src || '');
    if (!src) throw new FontFacesError(`${family} ${weight}: the ${subset} face is not one woff2 file (${decls.src})`);
    faces.push({ weight, subset, unicodeRange: decls['unicode-range'] || '', url: src[1] });
  }
  if (!blocks) throw new FontFacesError(`${family} ${weight}: the answer holds no @font-face rule`);
  const all = (css.match(/@font-face/g) || []).length;
  if (all !== blocks)
    throw new FontFacesError(`${family} ${weight}: ${all - blocks} @font-face rule(s) without a /* subset */ comment`);
  return faces;
}

// The default way to ask Google Fonts: null for 400 (the family lacks this weight, or Google does not know the
// family: collect tells them apart), the CSS text for 200. A request that takes over 30 seconds is given up.
async function fetchCss(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new FontFacesError(`cannot reach Google Fonts (${e.cause ? e.cause.code || e.cause.message : e.message})`);
  }
  if (res.status === 400) return null;
  if (res.status !== 200) throw new FontFacesError(`Google Fonts answered ${res.status} for ${url}`);
  return res.text();
}

// The whole record, from the families of a library and a CSS getter (tests pass their own; no network then).
async function collect(names, get = fetchCss) {
  const out = { source: SOURCE, weights: build.FONT_FACE_WEIGHTS, subsets: build.FONT_FACE_SUBSETS, families: {} };
  for (const family of names) {
    const weights = [];
    const faces = [];
    for (const weight of build.FONT_FACE_WEIGHTS) {
      const css = await get(requestUrl(family, weight));
      if (css === null) continue;
      weights.push(weight);
      faces.push(...parse(css, family, weight));
    }
    faces.sort(
      (a, b) =>
        a.weight - b.weight || build.FONT_FACE_SUBSETS.indexOf(a.subset) - build.FONT_FACE_SUBSETS.indexOf(b.subset)
    );
    if (!weights.length)
      throw new FontFacesError(
        `Google Fonts has none of the weights ${build.FONT_FACE_WEIGHTS.join(', ')} of "${family}" (is the name right?)`
      );
    out.families[family] = { weights, faces };
  }
  const problems = build.fontFacesProblems(out);
  if (problems.length) throw new FontFacesError(problems.join('; '));
  return out;
}

const render = (value) => JSON.stringify(value, null, 2) + '\n';

async function run({ libraryDir = path.join(ROOT, 'library'), get = fetchCss } = {}) {
  const names = families(libraryDir);
  const value = await collect(names, get);
  const file = path.join(libraryDir, 'font-faces.json');
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, render(value), { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw new FontFacesError(`cannot write ${file} (${e.code || e.message})`);
  }
  return { file, families: names.length, faces: Object.values(value.families).reduce((n, f) => n + f.faces.length, 0) };
}

async function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--library' && argv[i + 1]) opts.libraryDir = path.resolve(argv[++i]);
    else {
      process.stderr.write(
        `hawiya fonts: unknown option ${argv[i]}\nusage: node tools/font-faces.js [--library <dir>]\n`
      );
      return 2;
    }
  }
  try {
    const r = await run(opts);
    process.stdout.write(
      `hawiya fonts: wrote ${path.relative(process.cwd(), r.file) || r.file} (${r.families} Latin families, ${r.faces} faces)\n`
    );
    return 0;
  } catch (e) {
    if (!(e instanceof FontFacesError) && !(e instanceof build.LibraryError)) throw e;
    process.stderr.write(`hawiya fonts: ${e.message}; nothing was written\n`);
    (e.problems || []).forEach((p) => process.stderr.write(`  - ${p}\n`));
    return 1;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => (process.exitCode = code));

module.exports = {
  SOURCE,
  USER_AGENT,
  families,
  requestUrl,
  parse,
  fetchCss,
  collect,
  render,
  run,
  main,
  FontFacesError
};
