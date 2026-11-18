'use strict';
// A copy of the picker page whose data is the whole library with every draft published (made once per test
// process), so browser tests can draw every ready identity before the owner's review (task 5.5: the new identities
// of CHG-3 use drafts until task 5.6). Returns the file:// address of its index.html. The page code is the real one;
// the library files are not changed.
let fullPage = null;
function fullPickerPage() {
  if (fullPage) return fullPage;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { pathToFileURL } = require('url');
  const build = require('../../tools/build.js');
  const ROOT = path.join(__dirname, '..', '..');
  const lib = build.load(path.join(ROOT, 'library'));
  for (const list of Object.values(lib.templates))
    for (const t of list) if (t.status.state !== 'reviewed') t.status = { state: 'reviewed', reviewedAt: '2026-11-18' };
  const data = build.select(lib).data;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-full-'));
  fs.cpSync(path.join(ROOT, 'picker'), dir, { recursive: true });
  for (const [name, text] of Object.entries(build.render(data))) fs.writeFileSync(path.join(dir, 'data', name), text);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  fullPage = pathToFileURL(path.join(dir, 'index.html')).href;
  return fullPage;
}

module.exports = { fullPickerPage };
