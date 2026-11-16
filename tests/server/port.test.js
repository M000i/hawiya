'use strict';

/*
 * The save servers' fixed port (task 3.0a, CHG-1: R-011, R-101). Both servers listen on 127.0.0.1:47821 so the page
 * keeps one address (and the browser keeps the saved identities) from one run to the next; when that port is busy
 * they fall back to a random one and say so in the ready line. The link carries a short project id (a fingerprint
 * of the project's real path, never the path) for the page's per-project draft.
 * The tests in this file run one after another: they are the only ones that use the fixed port (every other server
 * test passes --port 0).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('./runner.js');

const FIXED = 47821;
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const PYTHON = process.env.HAWIYA_PYTHON || 'python3';
const hasPython = spawnSync(PYTHON, ['-c', 'pass']).status === 0;
const SERVERS = [['node', [process.execPath, path.join(SCRIPTS, 'serve.js')]]].concat(
  hasPython ? [['python', [PYTHON, '-I', path.join(SCRIPTS, 'serve.py')]]] : []
);

// The expected project id, computed here independently: sha256("hawiya-project:" + real path), first 16 hex digits;
// on macOS and Windows the path in NFC and lowercased (those file systems ignore case and Unicode form).
const FOLDS = process.platform === 'darwin' || process.platform === 'win32';
const idOf = (dir) => {
  let p = fs.realpathSync(dir);
  if (FOLDS) p = p.normalize('NFC').toLowerCase().normalize('NFC');
  return crypto
    .createHash('sha256')
    .update('hawiya-project:' + p, 'utf8')
    .digest('hex')
    .slice(0, 16);
};
const fragment = (s) => new URLSearchParams(new URL(s.ready.url).hash.slice(1));

async function stop(s) {
  if (!s.exited) {
    s.child.kill();
    await s.exitPromise;
  }
}

// A plain request with any Host header (the servers check it exactly).
const get = (port, p, headers = {}) => R.rawRequest(port, { method: 'GET', path: p, headers });

// A Hawiya server already running (an abandoned run idles for up to an hour, or `npm run dev`), or any other
// program, may hold the fixed port: then these tests cannot check it and are skipped with a clear note.
const busy =
  spawnSync(process.execPath, [
    '-e',
    `const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen(${FIXED},'127.0.0.1',()=>s.close(()=>process.exit(0)))`
  ]).status !== 0;
if (busy) test(`port ${FIXED} is already in use on this machine: fixed-port tests skipped`, { skip: true }, () => {});

for (const [label, cmd] of busy ? [] : SERVERS) {
  test(`[${label}] listens on 127.0.0.1:${FIXED} by default; the link carries the token and the project id`, async () => {
    const p = R.makeProject();
    const s = await R.startServer(cmd, p.project, [], undefined, { defaultPort: true });
    try {
      const u = new URL(s.ready.url);
      assert.equal(u.hostname, '127.0.0.1');
      assert.equal(Number(u.port), FIXED);
      assert.equal(s.ready.port, FIXED);
      assert.equal(s.ready.fallback, false);
      assert.equal(u.search, '');
      assert.ok(fragment(s).get('token').length >= 32);
      assert.equal(fragment(s).get('project'), idOf(p.project));
      assert.match(fragment(s).get('project'), /^[0-9a-f]{16}$/);
      // The page and the API answer on this address.
      assert.equal((await get(FIXED, '/', { Host: `127.0.0.1:${FIXED}` })).status, 200);
    } finally {
      await stop(s);
      R.cleanup(p.root, p.project);
    }
  });

  test(`[${label}] two runs one after another get the same address; two projects get different ids`, async () => {
    const a = R.makeProject();
    const b = R.makeProject();
    try {
      const s1 = await R.startServer(cmd, a.project, [], undefined, { defaultPort: true });
      await get(FIXED, '/', { Host: `127.0.0.1:${FIXED}` }); // a served connection, as the browser makes
      await stop(s1);
      const s2 = await R.startServer(cmd, a.project, [], undefined, { defaultPort: true });
      await stop(s2);
      const s3 = await R.startServer(cmd, b.project, [], undefined, { defaultPort: true });
      await stop(s3);
      assert.deepEqual(
        [s1, s2, s3].map((s) => [s.ready.port, s.ready.fallback]),
        [
          [FIXED, false],
          [FIXED, false],
          [FIXED, false]
        ]
      );
      assert.equal(fragment(s1).get('project'), fragment(s2).get('project'), 'same project, same id');
      assert.notEqual(fragment(s1).get('project'), fragment(s3).get('project'), 'two projects, two ids');
      assert.notEqual(fragment(s1).get('token'), fragment(s2).get('token'), 'a new token every run');
    } finally {
      R.cleanup(a.root, a.project);
      R.cleanup(b.root, b.project);
    }
  });

  test(`[${label}] the project id never shows the path; a link to the project gives the same id`, async () => {
    const p = R.makeProject();
    const named = path.join(p.root, 'مشروع-سري-secret-name');
    fs.mkdirSync(named);
    const link = path.join(p.root, 'link-to-it');
    fs.symlinkSync(named, link);
    try {
      const s1 = await R.startServer(cmd, named, [], undefined, { defaultPort: true });
      await stop(s1);
      const s2 = await R.startServer(cmd, link, [], undefined, { defaultPort: true });
      await stop(s2);
      for (const s of [s1, s2]) {
        assert.doesNotMatch(s.ready.url, /secret|%D9|link-to-it|hawiya-/i);
        assert.equal(fragment(s).get('project'), idOf(named));
      }
    } finally {
      R.cleanup(p.root, p.project);
    }
  });

  test(
    `[${label}] macOS / Windows: the same folder written in another case or Unicode form gets the same id`,
    {
      skip: !FOLDS && 'only on file systems that ignore case and Unicode form'
    },
    async () => {
      const p = R.makeProject();
      const nfc = 'Caf\u00e9-Proj';
      fs.mkdirSync(path.join(p.root, nfc));
      try {
        const ids = [];
        for (const name of [nfc, 'caf\u00e9-proj', 'Cafe\u0301-Proj'.normalize('NFD'), 'CAF\u00c9-PROJ']) {
          const s = await R.startServer(cmd, path.join(p.root, name), [], undefined, { defaultPort: true });
          await stop(s);
          ids.push(fragment(s).get('project'));
        }
        assert.equal(new Set(ids).size, 1, JSON.stringify(ids));
        assert.equal(ids[0], idOf(path.join(p.root, nfc)));
      } finally {
        R.cleanup(p.root, p.project);
      }
    }
  );

  test(`[${label}] when ${FIXED} is busy: a random port, and the ready line says it is the fallback`, async () => {
    const blocker = net.createServer();
    await new Promise((r, j) => blocker.once('error', j).listen(FIXED, '127.0.0.1', r));
    const p = R.makeProject();
    const s = await R.startServer(cmd, p.project, [], undefined, { defaultPort: true });
    try {
      const port = Number(new URL(s.ready.url).port);
      assert.notEqual(port, FIXED);
      assert.equal(s.ready.port, port);
      assert.equal(s.ready.fallback, true);
      assert.equal(fragment(s).get('project'), idOf(p.project));
      // Its own address works; the fixed one is not it.
      assert.equal((await get(port, '/', { Host: `127.0.0.1:${port}` })).status, 200);
      assert.equal((await get(port, '/', { Host: `127.0.0.1:${FIXED}` })).status, 403);
    } finally {
      await stop(s);
      await new Promise((r) => blocker.close(r));
      R.cleanup(p.root, p.project);
    }
  });

  test(`[${label}] on the fixed port, other hosts and other sites are still refused`, async () => {
    const p = R.makeProject();
    const s = await R.startServer(cmd, p.project, [], undefined, { defaultPort: true });
    try {
      for (const host of ['localhost:47821', '127.0.0.1:47822', 'evil.example', '127.0.0.1']) {
        assert.equal((await get(FIXED, '/', { Host: host })).status, 403, host);
      }
      const cross = await get(FIXED, '/api/session', {
        Host: `127.0.0.1:${FIXED}`,
        'Sec-Fetch-Site': 'cross-site',
        'X-Hawiya-Token': fragment(s).get('token')
      });
      assert.equal(cross.status, 403);
      const foreign = await R.rawRequest(FIXED, {
        method: 'POST',
        path: '/api/export',
        headers: {
          Host: `127.0.0.1:${FIXED}`,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
          'X-Hawiya-Token': fragment(s).get('token')
        },
        body: '{}'
      });
      assert.equal(foreign.status, 403);
      assert.equal(fs.existsSync(path.join(p.project, 'design')), false);
    } finally {
      await stop(s);
      R.cleanup(p.root, p.project);
    }
  });

  test(`[${label}] --port: 0 is a random port; anything that is not a port number is refused`, async () => {
    const p = R.makeProject();
    try {
      const s = await R.startServer(cmd, p.project, ['--port', '0']);
      await stop(s);
      assert.ok(s.ready.port > 0);
      assert.equal(s.ready.fallback, false);
      for (const bad of ['abc', '-1', '65536', '1.5', '']) {
        const r = spawnSync(cmd[0], [...cmd.slice(1), p.project, '--port', bad], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 2, `--port ${JSON.stringify(bad)}: ${r.stderr}`);
        assert.match(r.stderr, /--port/);
      }
    } finally {
      R.cleanup(p.root, p.project);
    }
  });
}
