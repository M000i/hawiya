'use strict';

/*
 * Reading the session (task 2.20, R-033 / R-003): from the end of the page link (#session=<base64url of the JSON>)
 * or from the local server's reply. Only a session that passes the session schema is used; anything else is
 * "damaged" and the page runs on its defaults. Nothing from it is ever written into the page as text.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const session = require('../picker/js/ui/session.js');

const VALID = { type: 'dashboard', language: 'ar+en', tags: ['corporate'], brandColors: ['#7c3aed'] };
const b64url = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashOf = (text) => '#session=' + b64url(text);

test('a valid session in the link is read exactly; the token may sit next to it', () => {
  assert.deepEqual(session.fromHash(hashOf(JSON.stringify(VALID))), { status: 'ok', session: VALID });
  assert.deepEqual(session.fromHash('#token=abc&session=' + b64url(JSON.stringify(VALID))), {
    status: 'ok',
    session: VALID
  });
  // encode() makes what the agent puts in the link (no + / = characters).
  assert.equal(session.encode(VALID), b64url(JSON.stringify(VALID)));
  assert.doesNotMatch(session.encode(VALID), /[+/=]/);
  assert.deepEqual(session.fromHash('#session=' + session.encode(VALID)).session, VALID);
  // Arabic or other non-ASCII bytes survive (UTF-8), e.g. a padding-sensitive length.
  const minimal = { type: 'landing', language: 'ar', tags: ['soft', 'playful'] };
  assert.deepEqual(session.fromHash(hashOf(JSON.stringify(minimal))).session, minimal);
});

test('no session in the link: none', () => {
  for (const h of ['', '#', '#token=abc', '#other=1', '#session=']) {
    assert.deepEqual(session.fromHash(h), { status: h === '#session=' ? 'damaged' : 'none', session: null }, h);
  }
});

test('the agent may write plain base64 or base64url, with or without padding', () => {
  const text = JSON.stringify({ type: 'landing', language: 'ar', tags: ['soft'] }); // its base64 ends in =
  const plain = Buffer.from(text, 'utf8').toString('base64');
  assert.match(plain, /=$/);
  for (const v of [
    plain,
    plain.replace(/=+$/, ''),
    Buffer.from(text).toString('base64url'),
    plain.replace(/=/g, '%3D')
  ]) {
    assert.deepEqual(session.fromHash('#session=' + v), { status: 'ok', session: JSON.parse(text) }, v);
  }
  assert.deepEqual(session.fromHash('#session=' + plain.replace(/=+$/, '') + '==='), {
    status: 'damaged',
    session: null
  }); // 3 =
});

test('the command SKILL.md gives the agent (base64 of the pretty-printed file) gives a link the page reads', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /base64 < "<project>\/design\/hawiya-session\.json" \| tr -d '\\n'/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-b64-'));
  try {
    const file = path.join(dir, 'hawiya-session.json');
    fs.writeFileSync(file, JSON.stringify(VALID, null, 2) + '\n');
    const b64 = execFileSync('sh', ['-c', 'base64 < "$1" | tr -d \'\\n\'', 'sh', file], { encoding: 'utf8' });
    assert.deepEqual(session.fromHash('#session=' + b64), { status: 'ok', session: VALID });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a server that gives no answer about the session (wrong token, refused, error): unreachable', () => {
  for (const [status, body] of [
    [401, '{"error":"bad token"}'],
    [403, '{"error":"foreign origin"}'],
    [500, '']
  ]) {
    assert.deepEqual(session.fromServer(status, body), { status: 'unreachable', session: null }, String(status));
  }
});

test('a damaged session is never used', () => {
  const cases = {
    'not base64': '#session=%%%',
    'base64 of invalid UTF-8': '#session=' + Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url'),
    'not JSON': hashOf('{type: dashboard}'),
    'JSON but not an object': hashOf('[1,2]'),
    'missing field': hashOf(JSON.stringify({ type: 'dashboard', language: 'ar' })),
    'unknown tag': hashOf(JSON.stringify({ ...VALID, tags: ['cute'] })),
    'uppercase color': hashOf(JSON.stringify({ ...VALID, brandColors: ['#7C3AED'] })),
    'extra field': hashOf(JSON.stringify({ ...VALID, note: 'hello' })),
    'same key twice': hashOf('{"type":"dashboard","language":"ar","tags":["soft"],"tags":["corporate"]}'),
    'two session values': hashOf(JSON.stringify(VALID)) + '&session=' + b64url(JSON.stringify(VALID)),
    'too long (valid JSON, padded with spaces)': hashOf(JSON.stringify(VALID) + ' '.repeat(5000))
  };
  for (const [name, h] of Object.entries(cases)) {
    assert.deepEqual(session.fromHash(h), { status: 'damaged', session: null }, name);
  }
});

test('hostile text is refused before anything could show it; no prototype is touched', () => {
  const hostile = [
    { ...VALID, tags: ['<img src=x onerror=alert(1)>'] },
    { ...VALID, brandColors: ['#000000;background:url(https://evil.example)'] },
    { ...VALID, type: '</script><script>alert(1)</script>' },
    JSON.parse('{"type":"dashboard","language":"ar","tags":["soft"],"__proto__":{"polluted":true}}')
  ];
  for (const h of hostile) {
    const text = JSON.stringify(h);
    assert.deepEqual(session.fromHash(hashOf(text)), { status: 'damaged', session: null }, text);
  }
  // __proto__ written literally in the text.
  const raw = '{"type":"dashboard","language":"ar","tags":["soft"],"__proto__":{"polluted":true}}';
  assert.deepEqual(session.fromHash(hashOf(raw)), { status: 'damaged', session: null });
  assert.equal({}.polluted, undefined);
  // A session that is used is a fresh copy: changing it later cannot reach the text it came from.
  const r = session.fromHash(hashOf(JSON.stringify(VALID)));
  assert.equal(Object.isFrozen(r.session), true);
  assert.equal(Object.isFrozen(r.session.tags), true);
});

test('the server reply: 200 with a valid session; 404 "no session" none; anything else damaged', () => {
  const ok = JSON.stringify({ session: VALID });
  assert.deepEqual(session.fromServer(200, ok), { status: 'ok', session: VALID });
  assert.deepEqual(session.fromServer(404, '{"error":"no session"}'), { status: 'none', session: null });
  for (const [status, body] of [
    [404, '{"error":"the session file is not valid: /tags/0 (enum)"}'],
    [404, '{"error":"the session file is not a plain file; not read"}'],
    [404, 'not json'],
    [200, '{"session":{"type":"dashboard"}}'],
    [200, 'not json'],
    [200, JSON.stringify({ session: { ...VALID, tags: ['<b>x</b>'] } })],
    [200, JSON.stringify({ other: VALID })],
    [200, JSON.stringify({ session: VALID }) + ' '.repeat(70000)],
    [200, '']
  ]) {
    assert.deepEqual(
      session.fromServer(status, body),
      { status: 'damaged', session: null },
      `${status} ${body.slice(0, 40)}`
    );
  }
});

test('the session example in SKILL.md passes and survives the link', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const example = JSON.parse(skill.match(/```json\n(\{[^`]+\})\n```/)[1]);
  assert.deepEqual(session.fromHash('#session=' + session.encode(example)), { status: 'ok', session: example });
});

test('loads as a plain browser script after validate.js and schemas.js', () => {
  const vm = require('node:vm');
  const core = path.join(__dirname, '..', 'picker', 'js', 'core');
  const sandbox = { self: {}, atob, TextDecoder, TextEncoder, btoa };
  vm.createContext(sandbox);
  for (const f of ['schemas.js', 'validate.js']) vm.runInContext(fs.readFileSync(path.join(core, f), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'ui', 'session.js'), 'utf8'), sandbox);
  const r = sandbox.self.Hawiya.sessionData.fromHash(hashOf(JSON.stringify(VALID)));
  assert.equal(r.status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(r.session)), VALID);
});
