#!/usr/bin/env node
'use strict';

/*
 * The library review server (task 3.4, R-061, R-065): for the owner only, never published, not part of the skill.
 * It follows the save server's rules (scripts/serve.js, plan.md §9) where they fit a tool that writes many times.
 *
 *   npm run review                       opens the review page in the browser
 *   node tools/review-server.js [--library <dir>] [--port <n>] [--idle-timeout <seconds>] [--no-open]
 *
 * - Listens on 127.0.0.1 only, on a random port (--port for tests). Prints one JSON line when ready:
 *     {"status":"ready","url":"http://127.0.0.1:<port>/#token=<token>","port":<port>}
 *   and opens that address in the browser (not with --no-open).
 * - Every API request needs the token (X-Hawiya-Token, compared in constant time); five wrong tokens close the
 *   server. Only the exact Host is served; an Origin other than the page's own is refused (a POST must carry it);
 *   requests browsers mark as coming from another site are refused.
 * - GET /api/library    every template of every element, drafts too, the ready identities, and each template's
 *                       problems from `npm run check` (tools/check.js)
 * - POST /api/status    { element, id, state: "reviewed" | "draft", from: <the state the page showed>,
 *                         fingerprint: <the SHA-256 /api/library gave for that template's content> }
 *                       changes that one template's status in library/elements/<element>.json: "reviewed" with
 *                       today's date (reviewedAt), or "draft" without it. Refused when the file changed since
 *                       (another state, or other content than the page showed: 409), when approving a template the check finds problems in (409), for an
 *                       unknown element or id (400 / 404). JSON only, at most 4 KB. The element names the file (a
 *                       fixed list): no path ever comes from the request. The file is rewritten in its own format
 *                       through a temporary file and a rename, so it is never half written.
 * - Static files: the page (tools/review/) and the picker's scripts (picker/) only, no way out of either folder.
 * - Closes after the idle timeout (default two hours) or five wrong tokens: one {"status":"closed",...} line, exit 1.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const build = require('./build.js');
const check = require('./check.js');
const validate = require('../picker/js/core/validate.js');

const ROOT = path.join(__dirname, '..');
const ELEMENTS = build.ELEMENTS;
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_BODY_BYTES = 4096;
const MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_IDLE_SECONDS = 7200;
// Problems that belong to the whole library, not to one template: an approval changes them anyway.
const LIBRARY_WIDE = new Set(['data', 'notices']);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

/* ---------- arguments ---------- */

function usage(message) {
  process.stderr.write(
    `hawiya review: ${message}\nusage: node tools/review-server.js [--library <dir>] [--port <n>] [--idle-timeout <seconds>] [--no-open]\n`
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { library: path.join(ROOT, 'library'), port: 0, idle: DEFAULT_IDLE_SECONDS, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') opts.open = false;
    else if (a === '--library' && argv[i + 1]) opts.library = path.resolve(argv[++i]);
    else if (a === '--port' && /^\d{1,5}$/.test(argv[i + 1] || '') && Number(argv[i + 1]) <= 65535)
      opts.port = Number(argv[++i]);
    else if (a === '--idle-timeout' && /^\d{1,6}$/.test(argv[i + 1] || '') && Number(argv[i + 1]) > 0)
      opts.idle = Number(argv[++i]);
    else usage(`unknown or incomplete option ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
let libraryDir;
try {
  libraryDir = fs.realpathSync(opts.library);
} catch {
  usage(`no library at ${opts.library}`);
}
const elementsDir = path.join(libraryDir, 'elements');
if (!fs.existsSync(elementsDir)) usage(`no elements folder in ${libraryDir}`);
const pageRoot = fs.realpathSync(path.join(__dirname, 'review'));
const pickerRoot = fs.realpathSync(path.join(ROOT, 'picker'));

/* ---------- token ---------- */

const token = crypto.randomBytes(32).toString('base64url');
const tokenDigest = crypto.createHash('sha256').update(token).digest();
let failedAttempts = 0;

function tokenMatches(given) {
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), tokenDigest);
}

/* ---------- responses ---------- */

function baseHeaders(extra) {
  return Object.assign(
    {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin'
    },
    extra || {}
  );
}

function afterResponse(res, fn) {
  let done = false;
  const once = () => {
    if (!done) {
      done = true;
      fn();
    }
  };
  res.on('finish', once);
  res.on('close', once);
}

function sendJson(res, status, obj, extra) {
  const req = res.req;
  const dropBody = status >= 400 && req && !req.complete;
  res.writeHead(
    status,
    baseHeaders(
      Object.assign(
        { 'Content-Type': 'application/json; charset=utf-8' },
        dropBody ? { Connection: 'close' } : {},
        extra
      )
    )
  );
  res.end(JSON.stringify(obj));
  if (dropBody) afterResponse(res, () => req.complete || req.destroy());
}

process.stdout.on('error', () => {});
function printLine(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {
    /* stdout closed */
  }
}

let finished = false;
function finish(reason) {
  if (finished) return;
  finished = true;
  printLine({ status: 'closed', reason });
  server.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  setImmediate(() => process.exit(1));
}

process.on('uncaughtException', (err) => {
  if (!finished) {
    finished = true;
    printLine({ status: 'closed', reason: 'internal error: ' + (err && (err.code || err.message)) });
  }
  process.exit(1);
});

let idleTimer = null;
function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => finish('idle timeout'), opts.idle * 1000);
}

/* ---------- request checks ---------- */

const foreignSite = (req) => ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);

// The API gate: origin, site and token. True when the request was answered (refused).
function refused(req, res, { originRequired }) {
  const origin = req.headers.origin;
  if (originRequired ? origin !== serverOrigin : origin !== undefined && origin !== serverOrigin) {
    sendJson(res, 403, { error: 'foreign origin' });
    return true;
  }
  if (foreignSite(req)) {
    sendJson(res, 403, { error: 'foreign site' });
    return true;
  }
  // Only a request with the token keeps the server alive: anything else on this machine cannot.
  if (tokenMatches(req.headers['x-hawiya-token'])) {
    touch();
    return false;
  }
  failedAttempts++;
  sendJson(res, 401, { error: 'invalid token' });
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) afterResponse(res, () => finish('too many failed attempts'));
  return true;
}

/* ---------- the library ---------- */

// An element's file, read as the build reads it (strict UTF-8 JSON, no key twice, no __proto__), plain files only.
function readElement(element) {
  const file = path.join(elementsDir, `${element}.json`);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return { error: 'no file for this element', status: 404 };
  if (!st.isFile()) return { error: 'the element file is not a plain file', status: 409 };
  const problems = [];
  const list = build.readJson(file, problems);
  if (list === undefined || !Array.isArray(list))
    return { error: problems[0] || 'the file is not a list', status: 409 };
  return { file, list };
}

// Each template's problems from npm run check (only those about one template).
function templateProblems() {
  const out = {};
  const r = check.check({ libraryDir });
  for (const p of r.problems) {
    if (LIBRARY_WIDE.has(p.kind) || !p.template || !p.file) continue;
    const element = path.basename(p.file, '.json');
    if (!ELEMENTS.includes(element)) continue;
    const key = `${element}/${p.template}`;
    (out[key] = out[key] || []).push({ kind: p.kind, message: p.message });
  }
  return out;
}

function handleLibrary(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });
  if (refused(req, res, { originRequired: false })) return;
  const elements = {};
  const errors = {};
  const fingerprints = {};
  for (const e of ELEMENTS) {
    const r = readElement(e);
    elements[e] = r.list || [];
    if (r.error) errors[e] = r.error;
    for (const t of elements[e]) {
      const key = `${e}/${t && typeof t === 'object' && typeof t.id === 'string' ? t.id : ''}`;
      if (t && typeof t === 'object' && !Array.isArray(t) && !(key in fingerprints)) fingerprints[key] = fingerprint(t);
    }
  }
  const identities = [];
  const dir = path.join(libraryDir, 'identities');
  if (fs.existsSync(dir)) {
    const problems = [];
    for (const name of build.listJson(dir, problems)) {
      const v = build.readJson(path.join(dir, name), problems);
      if (v && typeof v === 'object' && !Array.isArray(v)) identities.push(v);
    }
  }
  return sendJson(res, 200, { elements, identities, errors, fingerprints, problems: templateProblems() });
}

// What the page showed of a template: everything but its status (which this server changes).
function fingerprint(t) {
  const rest = Object.assign({}, t);
  delete rest.status;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Writes through a temporary file next to it, then renames: a reader never sees half a file.
function writeAtomically(file, text) {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

function changeStatus(body) {
  const keys = Object.keys(body).sort().join();
  if (keys !== 'element,fingerprint,from,id,state')
    return [400, { error: 'expected { element, id, state, from, fingerprint }' }];
  const { element, id, state, from, fingerprint: seen } = body;
  if (!ELEMENTS.includes(element)) return [400, { error: 'unknown element' }];
  // Approving needs a real id; returning to draft (the safe way) also works for a template whose id is broken.
  if (typeof id !== 'string' || id.length < 1 || id.length > 200 || (state === 'reviewed' && !ID.test(id)))
    return [400, { error: 'not a template id' }];
  if (typeof seen !== 'string' || !/^[0-9a-f]{64}$/.test(seen))
    return [400, { error: 'fingerprint is the hex SHA-256 the page was given' }];
  if (!['reviewed', 'draft'].includes(state) || !['reviewed', 'draft'].includes(from)) {
    return [400, { error: 'state and from are "reviewed" or "draft"' }];
  }
  const r = readElement(element);
  if (r.error) return [r.status, { error: r.error }];
  const at = r.list.findIndex((t) => t && typeof t === 'object' && t.id === id);
  if (at === -1) return [404, { error: 'no template with this id in this element' }];
  // Two entries with one id: neither can be told apart, so neither changes (npm run check names the duplicate).
  if (r.list.filter((x) => x && typeof x === 'object' && x.id === id).length > 1)
    return [409, { error: 'duplicate id' }];
  const t = r.list[at];
  const now = t.status && t.status.state;
  if (now !== from) return [409, { error: 'changed', state: now === undefined ? null : now }];
  // The content the page showed must be the content in the file: never approve what the owner did not see.
  if (fingerprint(t) !== seen) return [409, { error: 'changed', state: now === undefined ? null : now }];
  if (state === now) return [200, { element, id, state, unchanged: true, status: t.status }];
  if (state === 'reviewed') {
    const problems = templateProblems()[`${element}/${id}`];
    if (problems) return [409, { error: 'problems', problems }];
  }
  const changed = Object.assign({}, t, { status: state === 'reviewed' ? { state, reviewedAt: today() } : { state } });
  if (state === 'reviewed') {
    const result = validate.check('template', changed);
    if (!result.valid)
      return [409, { error: 'the template does not pass the schema', problems: result.errors.slice(0, 5) }];
  }
  r.list[at] = changed;
  writeAtomically(r.file, JSON.stringify(r.list, null, 2) + '\n');
  return [200, { element, id, state, status: changed.status }];
}

function handleStatus(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
  if (refused(req, res, { originRequired: true })) return;
  const type = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type !== 'application/json') return sendJson(res, 415, { error: 'content type must be application/json' });
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return sendJson(res, 413, { error: 'body too large' });
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: 'body too large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted || finished) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'body is not valid JSON' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return sendJson(res, 400, { error: 'expected an object' });
    let out;
    try {
      out = changeStatus(body);
    } catch (e) {
      return sendJson(res, 500, { error: 'could not write the library file (' + (e.code || e.message) + ')' });
    }
    if (out[0] === 200 && !out[1].unchanged)
      printLine({ status: 'changed', element: out[1].element, id: out[1].id, state: out[1].state });
    return sendJson(res, out[0], out[1]);
  });
}

/* ---------- static files ---------- */

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
  const notFound = () => sendJson(res, 404, { error: 'not found' });
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return notFound();
  if (decoded.split('/').some((seg) => seg === '..' || seg === '.')) return notFound();
  let root = pageRoot;
  let rel = decoded === '/' ? '/index.html' : decoded;
  if (rel.startsWith('/picker/')) {
    root = pickerRoot;
    rel = rel.slice('/picker'.length);
  }
  const target = path.resolve(root, '.' + rel);
  if (!target.startsWith(root + path.sep)) return notFound();
  let real;
  let content;
  try {
    real = fs.realpathSync(target);
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) return notFound();
    content = fs.readFileSync(real);
  } catch {
    return notFound();
  }
  const ext = path.extname(real).toLowerCase();
  if (!CONTENT_TYPES[ext]) return notFound();
  const headers = { 'Content-Type': CONTENT_TYPES[ext], 'Content-Length': content.length };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  res.writeHead(200, baseHeaders(headers));
  res.end(req.method === 'HEAD' ? undefined : content);
}

/* ---------- server ---------- */

let serverOrigin = null;
let expectedHost = null;

const server = http.createServer((req, res) => {
  if (finished) return sendJson(res, 503, { error: 'closing' });
  if (req.headers.host !== expectedHost) return sendJson(res, 403, { error: 'unexpected host' });
  const pathname = String(req.url || '/')
    .split('?')[0]
    .split('#')[0];
  if (pathname === '/api/library') return handleLibrary(req, res);
  if (pathname === '/api/status') return handleStatus(req, res);
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
  return handleStatic(req, res, pathname);
});
server.on('clientError', (err, socket) => socket.destroy());
server.headersTimeout = 10000;
server.requestTimeout = 30000;

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* the address is printed; the owner can open it */
  }
}

server.on('error', (e) => {
  if (finished) return;
  finished = true;
  printLine({ status: 'closed', reason: 'cannot listen on 127.0.0.1 (' + (e.code || e.message) + ')' });
  process.exit(1);
});
server.listen(opts.port, '127.0.0.1', () => {
  const port = server.address().port;
  expectedHost = '127.0.0.1:' + port;
  serverOrigin = 'http://' + expectedHost;
  touch();
  const url = serverOrigin + '/#token=' + token;
  printLine({ status: 'ready', url, port });
  if (opts.open) openBrowser(url);
});
