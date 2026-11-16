'use strict';

/*
 * Library -> page data (task 2.1, R-061): only templates the owner reviewed reach the published page.
 *
 *   npm run build                                   library/ -> picker/data/
 *   node tools/build.js --library <dir> --out <dir> other folders (tests)
 *   node tools/build.js --dry-run                   check and count, write nothing
 *
 * Input (plan.md §5):
 *   <library>/elements/<element>.json   a JSON array of templates (schema/template.schema.json), one file per element
 *   <library>/identities/<id>.json      a ready identity: one template per element, by id (IDENTITY_SCHEMA below)
 *
 * Output: one script per element, plus identities.js and starter.js, in <out>/. Scripts, not JSON, so the page also
 * works when opened as a file (file:// cannot fetch). Each sets window.Hawiya.data.templates[<element>] (or
 * .identities) to a frozen array; starter.js sets window.Hawiya.data.starter to { <element>: [templates the published
 * ready identities use] }, so the page can start without loading every element (task 2.9). Every non-ASCII character is written as \uXXXX, so the bytes do not depend on how the page declares
 * its encoding, and "<" is escaped so the data can never close a <script> element.
 *
 * Rules:
 * - Published = status.state is exactly "reviewed". Everything else (drafts) is left out and counted.
 * - The library must be sound before anything is written: files are strict UTF-8 JSON with no key written twice and
 *   no "__proto__" key anywhere (in a script it would set a prototype instead of making a key); every template passes
 *   the template schema; ids are unique across the whole library (a draft and a reviewed template must never share
 *   an id); each template sits in its own element's file; the folders hold only <element>.json / <identity>.json
 *   (dot files such as .DS_Store are ignored); every identity file has only the fields of IDENTITY_SCHEMA, so it
 *   cannot carry copied template content. Any problem: exit 1, nothing written.
 * - A ready identity is published only if it names a template for every element and every one of them is published
 *   and belongs to that element; otherwise it is left out and the reason is printed.
 * - Writing: every file goes to a temporary name first; only when all are written are they renamed into place, so a
 *   failed write leaves the previous page data as it was.
 * - Same library -> same bytes: no clock, templates in file order, identities by file name, keys as written.
 */

const fs = require('node:fs');
const path = require('node:path');
const validate = require('../picker/js/core/validate.js');
const SCHEMAS = require('../picker/js/core/schemas.js');
const recipe = require('../picker/js/core/recipe.js');

const ROOT = path.join(__dirname, '..');
const T = SCHEMAS.template;
const ELEMENTS = T.$defs.element.enum.slice(); // the 11 elements that have templates

const IDENTITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'templates'],
  properties: {
    id: T.$defs.id,
    name: T.properties.name,
    description: {
      type: 'object',
      additionalProperties: false,
      required: ['ar', 'en'],
      properties: { ar: { type: 'string', minLength: 1, maxLength: 300 }, en: { type: 'string', minLength: 1, maxLength: 300 } }
    },
    tags: { type: 'array', items: T.$defs.tag, minItems: 1, maxItems: 5, uniqueItems: true },
    templates: { type: 'object', minProperties: 1, propertyNames: { enum: ELEMENTS }, additionalProperties: T.$defs.id }
  }
};
const checkIdentity = validate.compile(IDENTITY_SCHEMA);
const UTF8 = new TextDecoder('utf-8', { fatal: true }); // a leading BOM is dropped; any bad byte is an error

class LibraryError extends Error {}
class WriteError extends Error {}

// Path of the first "__proto__" key, or null. Iterative: a deeply nested file cannot overflow the stack.
function protoKey(value) {
  const stack = [[value, '']];
  while (stack.length) {
    const [v, p] = stack.pop();
    if (!v || typeof v !== 'object') continue;
    for (const k of Object.keys(v)) {
      if (k === '__proto__') return p + '/__proto__';
      stack.push([v[k], p + '/' + k]);
    }
  }
  return null;
}

function readJson(file, problems) {
  let bytes;
  let text;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    problems.push(`${file}: cannot read (${e.code || e.message})`);
    return undefined;
  }
  try {
    text = UTF8.decode(bytes);
  } catch {
    problems.push(`${file}: not valid UTF-8 text`);
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    problems.push(`${file}: not valid JSON (${e.message})`);
    return undefined;
  }
  const dup = validate.duplicateKey(text);
  if (dup) {
    problems.push(`${file}: the key "${dup.key}" appears twice at ${dup.path || '/'}`);
    return undefined;
  }
  const proto = protoKey(value);
  if (proto) {
    problems.push(`${file}: the key "__proto__" is not allowed (at ${proto})`);
    return undefined;
  }
  return value;
}

// The data files of a library folder. Dot files are ignored; anything else must be a plain "<name>.json".
function listJson(dir, problems) {
  const names = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    if (!d.isFile()) problems.push(`${path.join(dir, d.name)}: not a plain file`);
    else if (!/^[^.]+\.json$/.test(d.name)) problems.push(`${path.join(dir, d.name)}: unexpected file (only <name>.json belongs here)`);
    else names.push(d.name);
  }
  return names.sort();
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function load(libraryDir) {
  const problems = [];
  const elementsDir = path.join(libraryDir, 'elements');
  if (!isDir(elementsDir)) throw new LibraryError(`no library found: ${elementsDir} is missing`);
  const templates = {}; // element -> all templates (drafts too), file order
  const hasFile = {};
  ELEMENTS.forEach((e) => {
    templates[e] = [];
    hasFile[e] = false;
  });
  const byId = new Map(); // id -> { template, file }

  for (const name of listJson(elementsDir, problems)) {
    const file = path.join(elementsDir, name);
    const element = name.slice(0, -'.json'.length);
    if (!ELEMENTS.includes(element)) {
      problems.push(`${file}: "${element}" is not an element (expected one of: ${ELEMENTS.join(', ')})`);
      continue;
    }
    hasFile[element] = true;
    const list = readJson(file, problems);
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`${file}: expected a JSON array of templates`);
      continue;
    }
    list.forEach((t, i) => {
      const where = `${file} [${i}]`;
      const result = validate.check('template', t);
      if (!result.valid) {
        result.errors.slice(0, 5).forEach((e) => problems.push(`${where}${e.instancePath}: ${e.message}`));
        return;
      }
      if (t.element !== element) problems.push(`${where}: template "${t.id}" says element "${t.element}" but is in ${name}`);
      // A recipe outside the allow-list is never published (script, outside requests, typography tricks).
      if (t.recipe) {
        recipe.check(t.recipe).forEach((p) => problems.push(`${where}: recipe ${p.where} not allowed: ${p.what}`));
      }
      if (byId.has(t.id)) problems.push(`${where}: id "${t.id}" is already used in ${byId.get(t.id).file}`);
      else byId.set(t.id, { template: t, file: name });
      templates[element].push(t);
    });
  }

  const identities = []; // { file, value }
  const identitiesDir = path.join(libraryDir, 'identities');
  if (fs.existsSync(identitiesDir)) {
    if (!isDir(identitiesDir)) throw new LibraryError(`${identitiesDir}: not a folder`);
    const seen = new Map();
    for (const name of listJson(identitiesDir, problems)) {
      const file = path.join(identitiesDir, name);
      const value = readJson(file, problems);
      if (value === undefined) continue;
      const result = checkIdentity(value);
      if (!result.valid) {
        result.errors.slice(0, 5).forEach((e) => problems.push(`${file}${e.instancePath}: ${e.message}`));
        continue;
      }
      if (seen.has(value.id)) problems.push(`${file}: identity id "${value.id}" is already used in ${seen.get(value.id)}`);
      else seen.set(value.id, name);
      identities.push({ file: name, value });
    }
  }

  if (problems.length) {
    const err = new LibraryError(`the library has ${problems.length} problem(s); nothing was written`);
    err.problems = problems;
    throw err;
  }
  return { templates, hasFile, byId, identities };
}

function isPublished(t) {
  return t.status.state === 'reviewed';
}

// Decide what is published. Pure: no disk access.
function select(lib) {
  const summary = { elements: {}, identities: { published: 0, excluded: [] }, totals: { published: 0, drafts: 0 } };
  const data = { templates: {}, identities: [] };
  for (const e of ELEMENTS) {
    const all = lib.templates[e];
    const out = all.filter(isPublished);
    data.templates[e] = out;
    summary.elements[e] = { published: out.length, drafts: all.length - out.length, file: lib.hasFile[e] };
    summary.totals.published += out.length;
    summary.totals.drafts += all.length - out.length;
  }
  for (const { file, value } of lib.identities) {
    const reasons = [];
    for (const element of ELEMENTS) {
      if (!Object.prototype.hasOwnProperty.call(value.templates, element)) {
        reasons.push(`${element}: no template chosen`);
        continue;
      }
      const id = value.templates[element];
      const hit = lib.byId.get(id);
      if (!hit) reasons.push(`${element}: "${id}" does not exist`);
      else if (hit.template.element !== element) reasons.push(`${element}: "${id}" is a ${hit.template.element} template`);
      else if (!isPublished(hit.template)) reasons.push(`${element}: "${id}" is a draft`);
    }
    if (reasons.length) summary.identities.excluded.push({ file, id: value.id, reasons });
    else data.identities.push(value);
  }
  summary.identities.published = data.identities.length;
  return { data, summary };
}

function scriptText(json) {
  let s = '';
  for (const ch of json) {
    const c = ch.codePointAt(0);
    if (c < 0x80 && ch !== '<') s += ch;
    else if (c <= 0xffff) s += '\\u' + c.toString(16).padStart(4, '0');
    else {
      const v = c - 0x10000;
      s += '\\u' + (0xd800 + (v >> 10)).toString(16) + '\\u' + (0xdc00 + (v & 0x3ff)).toString(16);
    }
  }
  return s;
}

function renderFile(kind, key, list) {
  const target =
    kind === 'identities' ? 'd.identities' : kind === 'starter' ? 'd.starter' : `d.templates[${JSON.stringify(key)}]`;
  return (
    '/* GENERATED by tools/build.js from library/ (reviewed templates only). Do not edit: change the library and run\n' +
    '   `npm run build`. Browser: window.Hawiya.data. */\n' +
    '(function (root, list) {\n' +
    '  (function freeze(o) {\n' +
    '    Object.freeze(o);\n' +
    '    Object.keys(o).forEach(function (k) {\n' +
    "      if (o[k] && typeof o[k] === 'object') freeze(o[k]);\n" +
    '    });\n' +
    '  })(list);\n' +
    '  root.Hawiya = root.Hawiya || {};\n' +
    '  var d = (root.Hawiya.data = root.Hawiya.data || {});\n' +
    '  d.templates = d.templates || {};\n' +
    `  ${target} = list;\n` +
    "})(typeof self !== 'undefined' ? self : this, " +
    scriptText(JSON.stringify(list, null, 2)) +
    ');\n'
  );
}

// The templates the published ready identities use, per element, in the element file's order (task 2.9).
// The page starts with these only; an element's full file loads when its gallery is first opened.
function starter(data) {
  const out = {};
  for (const e of ELEMENTS) {
    const used = new Set(data.identities.map((i) => i.templates[e]));
    out[e] = data.templates[e].filter((t) => used.has(t.id));
  }
  return out;
}

// File name -> content for everything the page needs. Same library, same bytes.
function render(data) {
  const files = {};
  for (const e of ELEMENTS) files[`${e}.js`] = renderFile('templates', e, data.templates[e]);
  files['identities.js'] = renderFile('identities', null, data.identities);
  files['starter.js'] = renderFile('starter', null, starter(data));
  return files;
}

function writeAll(outDir, files) {
  const temps = []; // only temp files this run created ('wx'), so cleanup never touches anything else
  const cleanup = () =>
    temps.forEach(([tmp]) => {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    });
  try {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      const tmp = path.join(outDir, `.${name}.${process.pid}.tmp`);
      const fd = fs.openSync(tmp, 'wx'); // fails if the name exists: never take over someone else's file
      temps.push([tmp, path.join(outDir, name)]); // ours from here on, even if the write below fails halfway
      try {
        fs.writeFileSync(fd, text);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (e) {
    cleanup();
    throw new WriteError(`cannot write ${outDir} (${e.code || e.message}); the page data was left as it was`);
  }
  for (let i = 0; i < temps.length; i++) {
    try {
      fs.renameSync(temps[i][0], temps[i][1]); // a reader never sees half a file
    } catch (e) {
      temps.splice(0, i); // already in place
      cleanup();
      throw new WriteError(`cannot replace ${temps[0][1]} (${e.code || e.message}); run the build again`);
    }
  }
}

function build({ libraryDir = path.join(ROOT, 'library'), outDir = path.join(ROOT, 'picker', 'data'), dryRun = false } = {}) {
  const lib = load(libraryDir);
  const { data, summary } = select(lib);
  const files = render(data);
  if (!dryRun) writeAll(outDir, files);
  return { summary, files };
}

function report(summary, { libraryDir, outDir, dryRun }) {
  const lines = [`hawiya build: ${libraryDir} -> ${dryRun ? '(dry run, nothing written)' : outDir}`];
  for (const e of ELEMENTS) {
    const s = summary.elements[e];
    lines.push(`  ${e.padEnd(11)} published ${String(s.published).padStart(3)}   drafts left out ${String(s.drafts).padStart(3)}${s.file ? '' : '   (no file)'}`);
  }
  const ids = summary.identities;
  lines.push(`  ${'identities'.padEnd(11)} published ${String(ids.published).padStart(3)}   left out ${String(ids.excluded.length).padStart(3)}`);
  for (const x of ids.excluded) lines.push(`    left out ${x.file}: ${x.reasons.join('; ')}`);
  lines.push(`total: ${summary.totals.published} templates published, ${summary.totals.drafts} drafts left out; ${ids.published} identities published, ${ids.excluded.length} left out`);
  return lines.join('\n');
}

function main(argv) {
  const opts = { libraryDir: path.join(ROOT, 'library'), outDir: path.join(ROOT, 'picker', 'data'), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if ((a === '--library' || a === '--out') && argv[i + 1]) opts[a === '--library' ? 'libraryDir' : 'outDir'] = path.resolve(argv[++i]);
    else {
      process.stderr.write(`hawiya build: unknown option ${a}\nusage: node tools/build.js [--library <dir>] [--out <dir>] [--dry-run]\n`);
      return 2;
    }
  }
  try {
    const { summary } = build(opts);
    process.stdout.write(report(summary, opts) + '\n');
    return 0;
  } catch (e) {
    if (!(e instanceof LibraryError) && !(e instanceof WriteError)) throw e;
    process.stderr.write(`hawiya build: ${e.message}\n`);
    (e.problems || []).forEach((p) => process.stderr.write(`  - ${p}\n`));
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { ELEMENTS, IDENTITY_SCHEMA, build, load, select, render, renderFile, starter, scriptText, report, main, LibraryError, WriteError };
