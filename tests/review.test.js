'use strict';
// Task 3.4 (R-061, R-065): the review server changes one template's status in its library file, with today's date,
// only for a request from its own page with the token; everything else is refused and nothing is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'tools', 'review-server.js');

// A copy of the library with one draft (radius-pill) and one draft the check refuses (radius-gpl).
function library() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-review-'));
  const lib = path.join(dir, 'library');
  fs.cpSync(path.join(ROOT, 'library'), lib, { recursive: true });
  const file = path.join(lib, 'elements', 'radius.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pill = JSON.parse(JSON.stringify(list[1]));
  Object.assign(pill, {
    id: 'radius-pill',
    name: { ar: 'زوايا كبسولية', en: 'Pill corners' },
    status: { state: 'draft' }
  });
  for (const k of ['sm', 'md', 'lg']) pill.tokens.radius[k].$value.value *= 3;
  const gpl = JSON.parse(JSON.stringify(pill));
  Object.assign(gpl, { id: 'radius-gpl', name: { ar: 'زوايا أخرى', en: 'Other corners' } });
  gpl.source = { ...gpl.source, license: 'GPL-3.0' };
  for (const k of ['sm', 'md', 'lg']) gpl.tokens.radius[k].$value.value += 40;
  list.push(pill, gpl);
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  return { dir, lib, file };
}

function start(lib, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--library', lib, '--no-open', '--port', '0', ...extra], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const lines = [];
    child.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) !== -1) {
        lines.push(JSON.parse(out.slice(0, i)));
        out = out.slice(i + 1);
        if (lines.length === 1) {
          const ready = lines[0];
          const token = ready.url.split('#token=')[1];
          resolve({ child, ready, token, port: ready.port, lines, lib, origin: `http://127.0.0.1:${ready.port}` });
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => (lines.length ? null : reject(new Error('exited ' + code))));
  });
}

// A raw request (Host, Origin and path exactly as given).
function request(s, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: s.port, method, path: p, headers: { Host: `127.0.0.1:${s.port}`, ...headers } },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text: data, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
// The fingerprint the page is given for a template: SHA-256 of its JSON without the status.
function fp(file, id) {
  const t = { ...JSON.parse(fs.readFileSync(file, 'utf8')).find((x) => x.id === id) };
  delete t.status;
  return crypto.createHash('sha256').update(JSON.stringify(t)).digest('hex');
}
// A status change as the page sends it; the fingerprint of the template as it is in the file unless given.
const post = (s, obj, headers = {}) => {
  if (typeof obj === 'object' && !Array.isArray(obj) && !('fingerprint' in obj)) {
    obj = { ...obj, fingerprint: fp(path.join(s.lib, 'elements', `${obj.element}.json`), obj.id) };
  }
  return request(s, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', Origin: s.origin, 'X-Hawiya-Token': s.token, ...headers },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj)
  });
};
const read = (file) => fs.readFileSync(file, 'utf8');
const find = (file, id) => JSON.parse(read(file)).find((t) => t.id === id);
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test(
  'the library is read with the token: every template, drafts too, and the check problems of each',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      assert.match(s.ready.url, /^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{43}$/);
      const r = await request(s, { path: '/api/library', headers: { 'X-Hawiya-Token': s.token } });
      assert.equal(r.status, 200);
      const ids = r.json.elements.radius.map((t) => t.id);
      assert.ok(ids.includes('radius-pill') && ids.includes('radius-gpl'));
      assert.equal(Object.keys(r.json.elements).length, 11);
      assert.equal(r.json.identities.length, fs.readdirSync(path.join(L.lib, 'identities')).length);
      assert.ok(
        r.json.problems['radius/radius-gpl'].some((p) => p.kind === 'license'),
        JSON.stringify(r.json.problems)
      );
      assert.equal(r.json.problems['radius/radius-pill'], undefined);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test(
  'approve writes "reviewed" with today\'s date; back to draft removes it; only that template changes',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      const before = JSON.parse(read(L.file));
      let r = await post(s, { element: 'radius', id: 'radius-pill', state: 'reviewed', from: 'draft' });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json.status, { state: 'reviewed', reviewedAt: today() });
      const after = JSON.parse(read(L.file));
      assert.deepEqual(find(L.file, 'radius-pill').status, { state: 'reviewed', reviewedAt: today() });
      assert.deepEqual(
        after.filter((t) => t.id !== 'radius-pill'),
        before.filter((t) => t.id !== 'radius-pill')
      );
      assert.equal(read(L.file), JSON.stringify(after, null, 2) + '\n', 'same format as the library files');
      assert.deepEqual(
        fs.readdirSync(path.dirname(L.file)).filter((n) => n.startsWith('.')),
        [],
        'no temporary file left'
      );
      r = await post(s, { element: 'radius', id: 'radius-pill', state: 'draft', from: 'reviewed' });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(find(L.file, 'radius-pill').status, { state: 'draft' });
      // A reviewed template of the real library can go back to draft too.
      r = await post(s, { element: 'radius', id: 'radius-sharp', state: 'draft', from: 'reviewed' });
      assert.equal(r.status, 200);
      assert.deepEqual(find(L.file, 'radius-sharp').status, { state: 'draft' });
      await new Promise((res) => setTimeout(res, 50));
      assert.ok(s.lines.some((l) => l.status === 'changed' && l.id === 'radius-pill' && l.state === 'reviewed'));
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test(
  'refused without the token, from another origin or host, or from another site; nothing is written',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      const before = read(L.file);
      const body = { element: 'radius', id: 'radius-pill', state: 'reviewed', from: 'draft' };
      const json = { 'Content-Type': 'application/json' };
      const cases = [
        [{ ...json, Origin: s.origin, 'X-Hawiya-Token': '' }, 401],
        [{ ...json, Origin: s.origin, 'X-Hawiya-Token': 'x'.repeat(43) }, 401],
        [{ ...json, Origin: 'http://evil.example', 'X-Hawiya-Token': s.token }, 403],
        [{ ...json, 'X-Hawiya-Token': s.token }, 403], // a POST must say where it comes from
        [{ ...json, Origin: s.origin, 'X-Hawiya-Token': s.token, 'Sec-Fetch-Site': 'cross-site' }, 403]
      ];
      for (const [headers, status] of cases) {
        const r = await request(s, { method: 'POST', path: '/api/status', headers, body: JSON.stringify(body) });
        assert.equal(r.status, status, JSON.stringify(headers));
      }
      let r = await request(s, {
        path: '/api/library',
        headers: { 'X-Hawiya-Token': s.token, Host: 'localhost:' + s.port }
      });
      assert.equal(r.status, 403, 'another host name');
      r = await request(s, { path: '/api/library' });
      assert.equal(r.status, 401, 'reading needs the token too');
      assert.equal(read(L.file), before);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test(
  'bad requests are refused and write nothing: type, size, shape, element, id, stale state, check problems',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      const before = read(L.file);
      const ok = {
        element: 'radius',
        id: 'radius-pill',
        state: 'reviewed',
        from: 'draft',
        fingerprint: fp(L.file, 'radius-pill')
      };
      const cases = [
        [JSON.stringify(ok), { 'Content-Type': 'text/plain' }, 415],
        ['{', {}, 400],
        [JSON.stringify({ ...ok, path: '../x' }), {}, 400],
        [JSON.stringify({ ...ok, element: '../elements/radius' }), {}, 400],
        [JSON.stringify({ ...ok, element: 'identities' }), {}, 400],
        [JSON.stringify({ ...ok, id: '../radius' }), {}, 400],
        [JSON.stringify({ ...ok, state: 'published' }), {}, 400],
        [JSON.stringify({ ...ok, id: 'radius-none' }), {}, 404],
        [JSON.stringify({ ...ok, fingerprint: undefined }), {}, 400],
        [JSON.stringify({ ...ok, fingerprint: 'x' }), {}, 400],
        [JSON.stringify({ ...ok, fingerprint: '0'.repeat(64) }), {}, 409],
        [JSON.stringify({ ...ok, from: 'reviewed' }), {}, 409],
        [JSON.stringify({ ...ok, note: 'x'.repeat(5000) }), {}, 413],
        [JSON.stringify([ok]), {}, 400]
      ];
      for (const [body, headers, status] of cases) {
        const r = await post(s, body, headers);
        assert.equal(r.status, status, body.slice(0, 80));
      }
      // A template the check finds problems in cannot be approved.
      const r = await post(s, { element: 'radius', id: 'radius-gpl', state: 'reviewed', from: 'draft' });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, 'problems');
      assert.ok(r.json.problems.some((p) => /GPL-3\.0/.test(p.message)));
      assert.equal(read(L.file), before);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test(
  'static files: the page (with a strict CSP) and the picker scripts only; nothing outside them',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      let r = await request(s, { path: '/' });
      assert.equal(r.status, 200);
      assert.match(r.headers['content-security-policy'], /script-src 'self'/);
      assert.match(r.text, /review\.js/);
      r = await request(s, { path: '/picker/js/core/color.js' });
      assert.equal(r.status, 200);
      for (const p of [
        '/../library/elements/radius.json',
        '/picker/../tools/review-server.js',
        '/picker/%2e%2e/package.json',
        '/%2e%2e/%2e%2e/etc/passwd',
        '/library/elements/radius.json',
        '/picker/data',
        '/api/other'
      ]) {
        r = await request(s, { path: p });
        assert.equal(r.status, 404, p);
      }
      r = await request(s, { method: 'DELETE', path: '/' });
      assert.equal(r.status, 405);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test('five wrong tokens close the server', { timeout: 30000 }, async () => {
  const L = library();
  const s = await start(L.lib);
  try {
    const exited = new Promise((res) => s.child.on('exit', res));
    for (let i = 0; i < 5; i++)
      await request(s, { path: '/api/library', headers: { 'X-Hawiya-Token': 'wrong' } }).catch(() => {});
    // Wait at most 5 s: a server that stays up fails the test (and is stopped in finally) instead of hanging the run.
    const code = await Promise.race([exited, new Promise((res) => setTimeout(() => res('still running'), 5000))]);
    assert.equal(code, 1);
    assert.ok(s.lines.some((l) => l.status === 'closed' && /too many failed attempts/.test(l.reason)));
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test(
  'a template whose content changed since the page loaded is not approved (the owner never saw it)',
  { timeout: 30000 },
  async () => {
    const L = library();
    const s = await start(L.lib);
    try {
      const shown = fp(L.file, 'radius-pill');
      const list = JSON.parse(read(L.file));
      list.find((t) => t.id === 'radius-pill').name.en = 'Pill corners (edited)';
      fs.writeFileSync(L.file, JSON.stringify(list, null, 2) + '\n');
      const before = read(L.file);
      const r = await post(s, {
        element: 'radius',
        id: 'radius-pill',
        state: 'reviewed',
        from: 'draft',
        fingerprint: shown
      });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, 'changed');
      assert.equal(read(L.file), before);
      // Approving again with what the page now shows works, and the status change keeps the fingerprint.
      const again = await request(s, { path: '/api/library', headers: { 'X-Hawiya-Token': s.token } });
      const now = again.json.fingerprints['radius/radius-pill'];
      assert.equal(now, fp(L.file, 'radius-pill'));
      assert.equal(
        (await post(s, { element: 'radius', id: 'radius-pill', state: 'reviewed', from: 'draft', fingerprint: now }))
          .status,
        200
      );
      assert.equal(fp(L.file, 'radius-pill'), now);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test(
  'a broken reviewed template can still go back to draft; unreadable element files are reported',
  { timeout: 30000 },
  async () => {
    const L = library();
    const list = JSON.parse(read(L.file));
    const odd = list.find((t) => t.id === 'radius-medium');
    odd.id = 'Radius Medium!';
    odd.tags = 'minimal';
    fs.writeFileSync(L.file, JSON.stringify(list, null, 2) + '\n');
    fs.writeFileSync(path.join(L.lib, 'elements', 'spacing.json'), '{ not json');
    const s = await start(L.lib);
    try {
      let r = await post(s, { element: 'radius', id: 'Radius Medium!', state: 'draft', from: 'reviewed' });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(JSON.parse(read(L.file)).find((t) => t.id === 'Radius Medium!').status, { state: 'draft' });
      r = await post(s, { element: 'radius', id: 'Radius Medium!', state: 'reviewed', from: 'draft' });
      assert.equal(r.status, 400, 'approving needs a real id');
      r = await request(s, { path: '/api/library', headers: { 'X-Hawiya-Token': s.token } });
      assert.match(r.json.errors.spacing, /not valid JSON/);
      assert.deepEqual(r.json.elements.spacing, []);
    } finally {
      s.child.kill();
      fs.rmSync(L.dir, { recursive: true, force: true });
    }
  }
);

test('requests without the token do not keep the server alive', { timeout: 30000 }, async () => {
  const L = library();
  const s = await start(L.lib, ['--idle-timeout', '2']);
  try {
    const exited = new Promise((res) => s.child.on('exit', res));
    const timer = setInterval(() => request(s, { path: '/' }).catch(() => {}), 300);
    const code = await Promise.race([exited, new Promise((res) => setTimeout(() => res('still running'), 6000))]);
    clearInterval(timer);
    assert.equal(code, 1);
    assert.ok(s.lines.some((l) => l.status === 'closed' && l.reason === 'idle timeout'));
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test('an id that appears twice is never changed (neither entry can be told apart)', { timeout: 30000 }, async () => {
  const L = library();
  const list = JSON.parse(read(L.file));
  const second = JSON.parse(JSON.stringify(list.find((t) => t.id === 'radius-sharp')));
  second.name.en = 'Second copy';
  list.push(second);
  fs.writeFileSync(L.file, JSON.stringify(list, null, 2) + '\n');
  const s = await start(L.lib);
  try {
    const before = read(L.file);
    const r = await post(s, { element: 'radius', id: 'radius-sharp', state: 'draft', from: 'reviewed' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'duplicate id');
    assert.equal(read(L.file), before);
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test('bad options exit 2', { timeout: 30000 }, async () => {
  const r = await new Promise((res) => {
    const c = spawn(process.execPath, [SERVER, '--port', 'x'], { stdio: 'ignore' });
    c.on('exit', res);
  });
  assert.equal(r, 2);
});
