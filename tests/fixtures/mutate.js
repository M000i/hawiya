'use strict';

/*
 * Applies one invalid-fixture case to a deep copy of its valid base document.
 * Case shape: { reason, base, set?: { "a.b.0.c": value }, delete?: ["a.b"], replace?: value }
 * Paths are dot-separated; numeric segments index arrays (delete on an array index removes that item).
 * Shared contract: the Python validator tests (task 1.13) implement the same rules.
 */

function walk(doc, path) {
  const parts = path.split('.');
  let node = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = Array.isArray(node) ? Number(parts[i]) : parts[i];
    if (node === null || typeof node !== 'object' || !(key in node)) {
      throw new Error(`path not found: ${path}`);
    }
    node = node[key];
  }
  const last = parts[parts.length - 1];
  return { node, key: Array.isArray(node) ? Number(last) : last };
}

function applyCase(base, c) {
  if (Object.prototype.hasOwnProperty.call(c, 'replace')) return JSON.parse(JSON.stringify(c.replace));
  const doc = JSON.parse(JSON.stringify(base));
  for (const [path, value] of Object.entries(c.set || {})) {
    const { node, key } = walk(doc, path);
    node[key] = value;
  }
  for (const path of c.delete || []) {
    const { node, key } = walk(doc, path);
    if (!(key in node)) throw new Error(`path not found: ${path}`);
    if (Array.isArray(node)) node.splice(key, 1);
    else delete node[key];
  }
  return doc;
}

module.exports = { applyCase };
