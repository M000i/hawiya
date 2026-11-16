#!/usr/bin/env node
/*
 * Hawiya save server (Node, no dependencies; task 1.12, plan.md section 6).
 *
 * Usage: node scripts/serve.js <project-dir> [--replace] [--idle-timeout <seconds>] [--port <n>]
 *
 * - Serves the picker page (picker/ only) on 127.0.0.1, port 47821 (CHG-1, task 3.0a): one address every run, so the
 *   browser keeps the saved identities. If that port is busy (or refused), a random port instead, and the ready line
 *   says so (fallback: true). --port <n> asks for exactly that port (0 = random; for tests), with no fallback.
 * - Prints one JSON line when ready:
 *     {"status":"ready","url":"http://127.0.0.1:<port>/#token=<token>&project=<id>","existing":[...],
 *      "replace":false,"port":<port>,"fallback":false}
 *   <id>: the first 16 hex digits of SHA-256("hawiya-project:" + the project's real path; on macOS and Windows in
 *   Unicode NFC, lowercased, since those file systems ignore case and form), so the page can keep a
 *   draft per project without the path ever leaving this process.
 * - GET /api/session (token in X-Hawiya-Token): returns {"session": ...} from <project>/design/hawiya-session.json
 *   when it is a plain file that passes the session schema; 404 otherwise.
 * - POST /api/export (token in X-Hawiya-Token, application/json, at most 5 MB): one complete export bundle
 *   (picker/js/core/bundle.js). It is accepted only when bundle.verify finds nothing wrong (format, all six files,
 *   each SHA-256, identity == identity.json) and identity.json, the exact text to be written, passes the identity
 *   checker (picker/js/core/validate.js). Only the six fixed names are written, into <project>/design/.
 *   Existing files are never replaced (409) unless --replace was given (the agent asks the user first); then the old
 *   files are first copied into design/backup-YYYYMMDD-HHMMSS/.
 *   On success prints {"status":"saved","written":[...]} and exits 0.
 * - Exits 1 with {"status":"closed","reason":...} after the idle timeout or 5 failed token attempts; 2 on bad usage.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CORE = path.join(__dirname, '..', 'picker', 'js', 'core');
const validator = require(path.join(CORE, 'validate.js'));
const bundleMod = require(path.join(CORE, 'bundle.js'));

const ALLOWED_FILES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_SESSION_BYTES = 64 * 1024;
const MAX_BODY_DEPTH = 64; // an export bundle needs about 8 levels; both servers refuse deeper bodies before parsing

/* Deepest nesting of [ and { outside strings, in one pass (the Python server counts the same way). */
function jsonDepth(text) {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) {
      inString = true;
    } else if (c === 91 || c === 123) {
      depth++;
      if (depth > deepest) deepest = depth;
    } else if (c === 93 || c === 125) {
      depth--;
    }
  }
  return deepest;
}
const SESSION_FILE = 'hawiya-session.json';
const DEFAULT_IDLE_SECONDS = 3600;
const FIXED_PORT = 47821;

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
  let replace = false;
  let port = null; // null = the fixed port with a fallback
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--replace') {
      replace = true;
    } else if (a === '--idle-timeout') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 86400) die('--idle-timeout must be an integer between 1 and 86400');
      idleSeconds = v;
    } else if (a === '--port') {
      const raw = argv[++i];
      const v = /^[0-9]{1,5}$/.test(raw || '') ? Number(raw) : NaN;
      if (!Number.isInteger(v) || v < 0 || v > 65535) die('--port must be an integer between 0 and 65535');
      port = v;
    } else if (a.startsWith('--')) {
      die('unknown option ' + a);
    } else if (projectArg === null) {
      projectArg = a;
    } else {
      die('only one project directory may be given');
    }
  }
  if (projectArg === null) die('usage: serve.js <project-dir> [--replace] [--idle-timeout <seconds>] [--port <n>]');
  let project;
  try {
    project = fs.realpathSync(projectArg);
  } catch {
    die('project directory does not exist: ' + projectArg);
  }
  if (!fs.statSync(project).isDirectory()) die('not a directory: ' + projectArg);
  return { project, idleSeconds, replace, port };
}

const { project, idleSeconds, replace, port: askedPort } = parseArgs(process.argv.slice(2));
// On macOS and Windows a folder's name ignores case and Unicode form, so "Proj" and "proj" (or a name typed in NFC or
// NFD) are the same folder and get the same id. serve.py does exactly the same.
const idPath =
  process.platform === 'darwin' || process.platform === 'win32'
    ? project.normalize('NFC').toLowerCase().normalize('NFC')
    : project;
const projectId = crypto.createHash('sha256').update('hawiya-project:' + idPath, 'utf8').digest('hex').slice(0, 16);
const designDir = path.join(project, 'design');
const pickerRoot = fs.realpathSync(path.join(__dirname, '..', 'picker'));

/* ---------- token ---------- */

const token = crypto.randomBytes(32).toString('base64url');
const tokenDigest = crypto.createHash('sha256').update(token).digest();
let failedAttempts = 0;
let tokenUsed = false; // set when a save starts: no second export can write, whatever its timing

function tokenMatches(given) {
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) return false;
  const digest = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(digest, tokenDigest);
}

/* Refuses a wrong, missing or used token (401). A failed SAVE counts, and five close the server; a failed READ of the
   session does not (count: false): with the fixed port (CHG-1) a tab left from an earlier run reads with its old
   token, and that must not close the new run. The 256-bit token cannot be guessed either way. True when refused. */
function refuseBadToken(req, res, count = true) {
  if (!tokenUsed && tokenMatches(req.headers['x-hawiya-token'])) return false;
  if (!count) {
    sendJson(res, 401, { error: 'invalid token' });
    return true;
  }
  failedAttempts++;
  sendJson(res, 401, { error: 'invalid token' });
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) afterResponse(res, () => finish(1, { reason: 'too many failed attempts' }));
  return true;
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

// The agent may stop reading after the ready line (e.g. `| head -n 1`): writing then fails with EPIPE, which must not
// turn a successful save into a crash. Lines that cannot be delivered are dropped; the exit code still tells.
process.stdout.on('error', () => {});

function printLine(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {
    /* stdout closed */
  }
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

/* Returns null, or { error, ... } explaining why the bundle is refused (400). */
function checkBundle(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'body must be a JSON object' };
  const problems = bundleMod.verify(payload);
  if (problems.length) {
    const named = problems.filter((p) => !p.startsWith('('));
    const unknown = named.filter((p) => !ALLOWED_FILES.includes(p));
    return {
      error: unknown.length
        ? 'file name not allowed: ' + unknown.slice(0, 10).join(', ')
        : 'the export bundle is incomplete or damaged: ' + problems.slice(0, 10).join(', '),
      problems: problems.slice(0, 20)
    };
  }
  // The text written to disk is what gets checked (no duplicate keys, nothing JSON.parse would hide).
  const result = validator.checkText('identity', payload.files['identity.json']);
  if (!result.valid) {
    return {
      error: 'identity is not valid',
      errors: result.errors.slice(0, 20).map((e) => ({ path: e.instancePath || '/', message: e.message }))
    };
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

/* On a case-insensitive disk a replaced Identity.json keeps its old spelling: give the entry its canonical name
   (after the content is in place, so nothing is ever missing). Best effort: the content is right either way. */
function canonicalCase(name) {
  try {
    const entry = fs.readdirSync(designDir).find((e) => e !== name && e.toLowerCase() === name.toLowerCase());
    if (entry && !fs.readdirSync(designDir).includes(name)) fs.renameSync(path.join(designDir, entry), path.join(designDir, name));
  } catch {
    /* leave the old spelling */
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/* design/backup-YYYYMMDD-HHMMSS (local time), with -2, -3 ... if that name is taken. */
function makeBackupDir() {
  const d = new Date();
  const base = 'backup-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  for (let i = 1; i < 100; i++) {
    const dir = path.join(designDir, i === 1 ? base : base + '-' + i);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('no free backup folder name');
}

/* Returns { status, body } on refusal, or { written } on success. Never writes outside designDir. */
function writeExport(files) {
  const st = lstatOrNull(designDir);
  if (st && !designIsPlainFolder()) {
    return { status: 409, body: { error: 'design exists but is not a plain folder; refusing to write' } };
  }
  let createdDesign = false;
  if (!st) {
    try {
      fs.mkdirSync(designDir);
      createdDesign = true;
    } catch (err) {
      return { status: 500, body: { error: 'cannot create the design folder: ' + err.code } };
    }
  }
  const removeCreatedDesign = () => {
    if (!createdDesign) return;
    try {
      fs.rmdirSync(designDir); // only if still empty
    } catch {
      /* not empty or gone */
    }
  };
  if (!designIsPlainFolder()) return { status: 409, body: { error: 'design is not a plain folder' } };

  const names = ALLOWED_FILES.filter((n) => Object.prototype.hasOwnProperty.call(files, n));
  const existing = names.filter((n) => lstatOrNull(path.join(designDir, n)) !== null);
  if (existing.length && !replace) {
    removeCreatedDesign();
    return { status: 409, body: { error: 'files already exist; not replacing (run the server with --replace after the user agrees)', existing } };
  }
  // Even with --replace, only plain files are replaced: never a link, a folder or anything else.
  const notPlain = existing.filter((n) => !(lstatOrNull(path.join(designDir, n)) || { isFile: () => false }).isFile());
  if (notPlain.length) return { status: 409, body: { error: 'not a plain file; refusing to replace', existing: notPlain } };
  const oldModes = {};
  existing.forEach((n) => {
    oldModes[n] = (lstatOrNull(path.join(designDir, n)) || { mode: 0o644 }).mode & 0o777;
  });

  const temps = [];
  const replaced = [];
  let backupDir = null;
  try {
    for (const name of names) {
      if (!designIsPlainFolder()) throw new Error('design folder changed during write');
      const tmp = path.join(designDir, '.' + name + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
      temps.push([tmp, path.join(designDir, name), name]); // listed before writing, so a partial file is cleaned up
      fs.writeFileSync(tmp, files[name], { encoding: 'utf8', flag: 'wx', mode: 0o644 });
      if (oldModes[name] !== undefined) fs.chmodSync(tmp, oldModes[name]); // a replaced file keeps its permissions
    }
    if (existing.length) {
      backupDir = makeBackupDir();
      for (const name of existing) {
        const from = path.join(designDir, name);
        const fst = lstatOrNull(from);
        if (!fst || !fst.isFile()) throw new Error('file changed during write: ' + name);
        fs.writeFileSync(path.join(backupDir, name), readPlainFile(from, Infinity), { flag: 'wx', mode: fst.mode & 0o777 });
      }
    }
    for (const [tmp, final, name] of temps) {
      if (!designIsPlainFolder()) throw new Error('design folder changed during write');
      const now = lstatOrNull(final);
      if (now !== null && !(existing.includes(name) && now.isFile())) throw new Error('file appeared during write: ' + name);
      fs.renameSync(tmp, final); // one atomic step: the old file (backed up above) is never missing in between
      replaced.push(name);
      canonicalCase(name);
    }
  } catch (err) {
    for (const [tmp] of temps) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* already renamed or gone */
      }
    }
    // Put back what was already replaced, from the backup; remove new files that had no old version.
    for (const name of replaced) {
      try {
        const final = path.join(designDir, name);
        fs.unlinkSync(final);
        if (backupDir && existing.includes(name)) fs.copyFileSync(path.join(backupDir, name), final, fs.constants.COPYFILE_EXCL);
      } catch {
        /* best effort */
      }
    }
    // After a full rollback the backup is redundant; it is removed only when every original is back on disk.
    if (backupDir && existing.every((n) => (lstatOrNull(path.join(designDir, n)) || { isFile: () => false }).isFile())) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* leave it */
      }
    }
    removeCreatedDesign();
    return { status: 500, body: { error: 'write failed: ' + (err.code || err.message) } };
  }
  const out = { written: names };
  if (backupDir) out.backup = path.basename(backupDir);
  return out;
}

function handleExport(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

  const origin = req.headers.origin;
  if (origin !== undefined && origin !== serverOrigin) return sendJson(res, 403, { error: 'foreign origin' });
  touch();

  if (refuseBadToken(req, res)) return;

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
    const text = Buffer.concat(chunks).toString('utf8');
    if (jsonDepth(text) > MAX_BODY_DEPTH) return sendJson(res, 400, { error: 'body is nested too deeply' });
    try {
      payload = JSON.parse(text);
    } catch {
      return sendJson(res, 400, { error: 'body is not valid JSON' });
    }
    if (tokenUsed) return sendJson(res, 401, { error: 'invalid token' }); // another export got there first
    const problem = checkBundle(payload);
    if (problem) return sendJson(res, 400, problem);

    tokenUsed = true; // claim the one save before touching the disk (synchronous from here to the end)
    const result = writeExport(payload.files);
    if (!result.written) {
      tokenUsed = false; // nothing was written: the token may be used again
      return sendJson(res, result.status, result.body);
    }

    // The files are on disk: from here the server closes no matter how the client behaves.
    const info = result.backup ? { written: result.written, backup: result.backup } : { written: result.written };
    const done = () => finish(0, info);
    sendJson(res, 200, info);
    afterResponse(res, done);
    setTimeout(done, 2000).unref();
  });
}

/* ---------- session ---------- */

/* Reads a plain file through one descriptor: no symlink, no blocking on a FIFO, and checks what was opened. */
function readPlainFile(file, maxBytes) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const fd = fs.openSync(file, flags);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error('not a plain file'), { code: 'ENOTFILE' });
    if (st.size > maxBytes) throw Object.assign(new Error('too large'), { code: 'ETOOBIG' });
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function handleSession(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== serverOrigin) return sendJson(res, 403, { error: 'foreign origin' });
  // GETs made by other sites carry no Origin (<img>, no-cors fetch) but browsers mark them: refused without counting
  // as an attempt (a hostile page could otherwise close the server) or as activity (or keep it alive).
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return sendJson(res, 403, { error: 'foreign site' });
  touch();
  if (refuseBadToken(req, res, false)) return;

  const none = (why) => sendJson(res, 404, { error: why });
  if (!designIsPlainFolder()) return none('no session');
  const file = path.join(designDir, SESSION_FILE);
  const st = lstatOrNull(file);
  if (!st) return none('no session');
  if (!st.isFile()) return none('the session file is not a plain file; not read');
  if (st.size > MAX_SESSION_BYTES) return none('the session file is too large; not read');
  let text;
  try {
    text = readPlainFile(file, MAX_SESSION_BYTES).toString('utf8');
  } catch {
    return none('the session file could not be read');
  }
  const result = validator.checkText('session', text);
  // Only places and rule names: never echo the file's content (it may not be what we expect).
  if (!result.valid) return none('the session file is not valid: ' + result.errors.slice(0, 3).map((e) => (e.instancePath || '/') + ' (' + e.keyword + ')').join('; '));
  return sendJson(res, 200, { session: JSON.parse(text) });
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
  if (pathname === '/api/session') return handleSession(req, res);
  return handleStatic(req, res, pathname);
});

server.on('clientError', (err, socket) => socket.destroy());
server.headersTimeout = 10000;
server.requestTimeout = 30000;

let fallback = false;

function onListening() {
  const port = server.address().port;
  expectedHost = '127.0.0.1:' + port;
  serverOrigin = 'http://' + expectedHost;
  touch();
  printLine({
    status: 'ready',
    url: serverOrigin + '/#token=' + token + '&project=' + projectId,
    existing: existingDesignFiles(),
    replace,
    port,
    fallback
  });
}

// The fixed port, or a random one when it is taken (or refused) by something else. An explicit --port is exact.
server.on('error', (e) => {
  if (expectedHost !== null) throw e; // after start-up: as before (the uncaught-exception handler closes cleanly)
  if (!fallback && askedPort === null && ['EADDRINUSE', 'EACCES', 'EPERM'].includes(e.code)) {
    fallback = true;
    server.listen(0, '127.0.0.1');
    return;
  }
  finished = true;
  printLine({ status: 'closed', reason: 'cannot listen on 127.0.0.1 (' + (e.code || e.message) + ')' });
  process.exit(1);
});
server.once('listening', onListening);
server.listen(askedPort === null ? FIXED_PORT : askedPort, '127.0.0.1');
