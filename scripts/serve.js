#!/usr/bin/env node
/*
 * Hawiya save server (Node, no dependencies).
 *
 * Usage: node scripts/serve.js <project-dir> [--idle-timeout <seconds>]
 *
 * - Serves the picker page on 127.0.0.1 at a random port.
 * - Prints one JSON line when ready: {"status":"ready","url":"http://127.0.0.1:<port>/#token=<token>","existing":[...]}
 * - Accepts one export (POST /api/export) carrying the one-time token in the X-Hawiya-Token header,
 *   writes only fixed file names into <project-dir>/design/, never replaces existing files,
 *   prints {"status":"saved","written":[...]} and exits 0.
 * - Exits 1 with {"status":"closed","reason":...} after the idle timeout or 5 failed token attempts.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ALLOWED_FILES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_IDLE_SECONDS = 3600;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

/* ---------- arguments ---------- */

function die(message) {
  process.stderr.write('hawiya serve: ' + message + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  let projectArg = null;
  let idleSeconds = DEFAULT_IDLE_SECONDS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--idle-timeout') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 86400) die('--idle-timeout must be an integer between 1 and 86400');
      idleSeconds = v;
    } else if (a.startsWith('--')) {
      die('unknown option ' + a);
    } else if (projectArg === null) {
      projectArg = a;
    } else {
      die('only one project directory may be given');
    }
  }
  if (projectArg === null) die('usage: serve.js <project-dir> [--idle-timeout <seconds>]');
  let project;
  try {
    project = fs.realpathSync(projectArg);
  } catch {
    die('project directory does not exist: ' + projectArg);
  }
  if (!fs.statSync(project).isDirectory()) die('not a directory: ' + projectArg);
  return { project, idleSeconds };
}

const { project, idleSeconds } = parseArgs(process.argv.slice(2));
const designDir = path.join(project, 'design');
const pickerRoot = fs.realpathSync(path.join(__dirname, '..', 'picker'));

/* ---------- token ---------- */

const token = crypto.randomBytes(32).toString('base64url');
const tokenDigest = crypto.createHash('sha256').update(token).digest();
let failedAttempts = 0;
let tokenUsed = false;

function tokenMatches(given) {
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) return false;
  const digest = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(digest, tokenDigest);
}

/* ---------- helpers ---------- */

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function existingDesignFiles() {
  const st = lstatOrNull(designDir);
  if (!st || !st.isDirectory()) return [];
  return ALLOWED_FILES.filter((name) => lstatOrNull(path.join(designDir, name)) !== null);
}

function baseHeaders(extra) {
  return Object.assign(
    {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY'
    },
    extra || {}
  );
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  // A refused request may still be sending a body; never keep reading it.
  const req = res.req;
  const dropBody = status >= 400 && req && !req.complete;
  const headers = Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8' },
    dropBody ? { Connection: 'close' } : {},
    extraHeaders
  );
  res.writeHead(status, baseHeaders(headers));
  res.end(body);
  if (dropBody) {
    afterResponse(res, () => {
      if (!req.complete) req.destroy();
    });
  }
  return res;
}

/* Run fn once the response is done, whether it finished normally or the client dropped the connection. */
function afterResponse(res, fn) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    fn();
  };
  res.on('finish', once);
  res.on('close', once);
}

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let finished = false;
function finish(code, info) {
  if (finished) return;
  finished = true;
  printLine(Object.assign({ status: code === 0 ? 'saved' : 'closed' }, info));
  server.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  setImmediate(() => process.exit(code));
}

/* Any unexpected error still honours the stdout contract: one "closed" line, exit 1. */
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
  idleTimer = setTimeout(() => finish(1, { reason: 'idle timeout' }), idleSeconds * 1000);
}

/* ---------- export ---------- */

function validateExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'body must be a JSON object';
  const files = payload.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return '"files" must be an object';
  const names = Object.keys(files);
  if (names.length === 0) return '"files" is empty';
  for (const name of names) {
    if (!ALLOWED_FILES.includes(name)) return 'file name not allowed: ' + name;
    if (typeof files[name] !== 'string') return 'content of ' + name + ' must be a string';
  }
  if (names.includes('identity.json')) {
    let parsed;
    try {
      parsed = JSON.parse(files['identity.json']);
    } catch {
      return 'identity.json is not valid JSON';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'identity.json must be a JSON object';
  }
  return null;
}

/* design must be a real folder directly inside the project (not a link, not swapped for one). */
function designIsPlainFolder() {
  const st = lstatOrNull(designDir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
  try {
    return fs.realpathSync(designDir) === designDir;
  } catch {
    return false;
  }
}

/* Returns { status, body } on refusal, or { written } on success. Never writes outside designDir. */
function writeExport(files) {
  const st = lstatOrNull(designDir);
  if (st && !designIsPlainFolder()) {
    return { status: 409, body: { error: 'design exists but is not a plain folder; refusing to write' } };
  }
  if (!st) {
    try {
      fs.mkdirSync(designDir);
    } catch (err) {
      return { status: 500, body: { error: 'cannot create the design folder: ' + err.code } };
    }
  }
  if (!designIsPlainFolder()) return { status: 409, body: { error: 'design is not a plain folder' } };

  const names = Object.keys(files);
  const clash = names.filter((n) => lstatOrNull(path.join(designDir, n)) !== null);
  if (clash.length) return { status: 409, body: { error: 'files already exist; not replacing', existing: clash } };

  const temps = [];
  try {
    for (const name of names) {
      if (!designIsPlainFolder()) throw new Error('design folder changed during write');
      const tmp = path.join(designDir, '.' + name + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
      fs.writeFileSync(tmp, files[name], { encoding: 'utf8', flag: 'wx', mode: 0o644 });
      temps.push([tmp, path.join(designDir, name)]);
    }
    for (const [tmp, final] of temps) {
      if (!designIsPlainFolder()) throw new Error('design folder changed during write');
      if (lstatOrNull(final) !== null) throw new Error('file appeared during write: ' + path.basename(final));
      fs.renameSync(tmp, final);
    }
  } catch (err) {
    for (const [tmp] of temps) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* already renamed or gone */
      }
    }
    return { status: 500, body: { error: 'write failed: ' + (err.code || err.message) } };
  }
  return { written: names };
}

function handleExport(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

  const origin = req.headers.origin;
  if (origin !== undefined && origin !== serverOrigin) return sendJson(res, 403, { error: 'foreign origin' });
  touch();

  if (tokenUsed || !tokenMatches(req.headers['x-hawiya-token'])) {
    failedAttempts++;
    sendJson(res, 401, { error: 'invalid token' });
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) afterResponse(res, () => finish(1, { reason: 'too many failed attempts' }));
    return;
  }

  const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return sendJson(res, 415, { error: 'content type must be application/json' });

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return sendJson(res, 413, { error: 'body too large' });
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      chunks.length = 0;
      sendJson(res, 413, { error: 'body too large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted || finished) return;
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'body is not valid JSON' });
    }
    const problem = validateExport(payload);
    if (problem) return sendJson(res, 400, { error: problem });

    const result = writeExport(payload.files);
    if (!result.written) return sendJson(res, result.status, result.body);

    // The files are on disk: from here the server closes no matter how the client behaves.
    tokenUsed = true;
    const done = () => finish(0, { written: result.written });
    sendJson(res, 200, { written: result.written });
    afterResponse(res, done);
    setTimeout(done, 2000).unref();
  });
}

/* ---------- static picker files ---------- */

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
  }
  // Browsers mark requests made by other sites; those do not count as activity.
  const site = req.headers['sec-fetch-site'];
  if (site !== 'cross-site' && site !== 'same-site') touch();
  const notFound = () => sendJson(res, 404, { error: 'not found' });

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return notFound();
  if (decoded.split('/').some((seg) => seg === '..' || seg === '.')) return notFound();

  let target = path.resolve(pickerRoot, '.' + decoded);
  if (target !== pickerRoot && !target.startsWith(pickerRoot + path.sep)) return notFound();

  let real;
  try {
    real = fs.realpathSync(target);
    if (fs.statSync(real).isDirectory()) real = fs.realpathSync(path.join(real, 'index.html'));
  } catch {
    return notFound();
  }
  if (!real.startsWith(pickerRoot + path.sep)) return notFound();
  let content;
  try {
    if (!fs.statSync(real).isFile()) return notFound();
    content = fs.readFileSync(real); // picker files are small; reading whole avoids stream error paths
  } catch {
    return notFound();
  }

  const type = CONTENT_TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Content-Length': content.length }));
  res.end(req.method === 'HEAD' ? undefined : content);
}

/* ---------- server ---------- */

let serverOrigin = null;
let expectedHost = null;

const server = http.createServer((req, res) => {
  if (finished) return sendJson(res, 503, { error: 'closing' });

  // Foreign hosts are refused. Only legitimate requests reset the idle timer (see handleExport/handleStatic),
  // so a hostile page cannot keep the server alive by pinging it.
  if (req.headers.host !== expectedHost) return sendJson(res, 403, { error: 'unexpected host' });

  const pathname = String(req.url || '/').split('?')[0].split('#')[0];
  if (pathname === '/api/export') return handleExport(req, res);
  return handleStatic(req, res, pathname);
});

server.on('clientError', (err, socket) => socket.destroy());
server.headersTimeout = 10000;
server.requestTimeout = 30000;

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  expectedHost = '127.0.0.1:' + port;
  serverOrigin = 'http://' + expectedHost;
  touch();
  printLine({ status: 'ready', url: serverOrigin + '/#token=' + token, existing: existingDesignFiles() });
});
