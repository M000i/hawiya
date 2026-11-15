/*
 * Identity / template / session checker (task 1.7, R-070, R-011). Browser: window.Hawiya.validate; Node: require.
 * One file, no libraries, shared by the picker page and the Node save server (plan.md §8). It is the barrier in
 * front of every write to disk, so it must accept and reject exactly what schema/*.json (checked with Ajv) does.
 *
 *   validate.check('identity', doc)       → { valid: true, errors: [] }  or  { valid: false, errors: [...] }
 *   validate.checkText('identity', text)  → same, after JSON.parse (text that is not JSON is rejected)
 *   validate.compile(schema)              → function (value) → { valid, errors }   (any schema using the keywords below)
 *
 * Each error is { instancePath, keyword, message, params }. instancePath is a JSON Pointer ("" = the whole document),
 * placed where Ajv places it: required / additionalProperties / propertyNames errors sit on the object itself.
 *
 * How it stays equal to the schema:
 * - It is a small JSON Schema 2020-12 interpreter, not hand-written rules: the schemas themselves are the rules.
 *   The schemas reach the browser through schemas.js, a generated copy of schema/*.json (a test keeps them equal).
 * - It knows exactly the keywords the three schemas use. A schema with any other keyword is refused when compiled,
 *   so a new rule can never be skipped in silence.
 * - Same meaning as Ajv: string length counts characters (code points), not UTF-16 units; patterns use the 'u' flag
 *   and are not anchored unless the pattern is; const / enum / uniqueItems compare JSON values deeply; "integer" is a
 *   whole number (4.0 is one).
 * - Keys are looked up as own properties only, so "constructor", "toString" or "__proto__" in a document are just
 *   unknown keys (rejected by additionalProperties: false), never taken from Object.prototype.
 * - Values that JSON cannot hold (NaN, Infinity, undefined, functions, dates, class instances) match no type, so a
 *   broken calculation in the page is rejected instead of being written as null. The whole value is checked for this
 *   first, including the open places (template tokens / extras): no getters, no holes or extra keys on arrays.
 *
 * Safety limits (it runs inside the save server's request handler and inside the page):
 * - Never throws on a document: anything nested deeper than MAX_DEPTH (far beyond any real file) is rejected.
 * - Numbers too large for a double (1e400 in the text) become Infinity in JSON.parse and are rejected everywhere,
 *   also in the open places: written back they would be "null" (JS) or "Infinity" (Python). Stricter than Ajv.
 * - At most MAX_ERRORS errors are listed; the verdict is unchanged.
 * - Linear time: duplicates are found with one pass over canonical JSON strings, not by comparing every pair.
 * - checkText also rejects an object with the same key twice. JSON.parse keeps only the last one, so the text on disk
 *   would carry a value nobody checked (stricter than Ajv, on purpose; the Python copy, task 1.13, must do the same).
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    module.exports = factory(require('./schemas.js'));
  } else {
    root.Hawiya = root.Hawiya || {};
    if (!root.Hawiya.schemas) throw new Error('Hawiya.validate: load schemas.js before validate.js');
    root.Hawiya.validate = factory(root.Hawiya.schemas);
  }
})(typeof self !== 'undefined' ? self : this, function (SCHEMAS) {
  'use strict';

  var hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);

  // Annotation keywords: no effect on the verdict.
  var IGNORED = { $schema: 1, $id: 1, $defs: 1, title: 1, description: 1 };
  var KNOWN = {
    type: 1, const: 1, enum: 1, $ref: 1, anyOf: 1, not: 1, if: 1, then: 1, else: 1,
    minLength: 1, maxLength: 1, pattern: 1, minimum: 1, maximum: 1,
    items: 1, minItems: 1, maxItems: 1, uniqueItems: 1,
    properties: 1, required: 1, additionalProperties: 1, propertyNames: 1, minProperties: 1, maxProperties: 1
  };
  var TYPES = { null: 1, boolean: 1, object: 1, array: 1, number: 1, integer: 1, string: 1 };
  var MAX_DEPTH = 200;
  var MAX_ERRORS = 100; // a rejected document reports at most this many errors (memory stays small on huge input)

  function fail(msg) {
    throw new Error('Hawiya.validate: ' + msg);
  }

  /* ---------- JSON value helpers ---------- */

  function isPlainObject(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
    var proto = Object.getPrototypeOf(x);
    return proto === Object.prototype || proto === null;
  }

  // The JSON type of a value, or null when JSON cannot hold it.
  function jsonType(x) {
    if (x === null) return 'null';
    if (typeof x === 'boolean') return 'boolean';
    if (typeof x === 'string') return 'string';
    if (typeof x === 'number') return isFinite(x) ? 'number' : null;
    if (Array.isArray(x)) return 'array';
    if (isPlainObject(x)) return 'object';
    return null;
  }

  function hasType(x, t) {
    var jt = jsonType(x);
    if (t === 'integer') return jt === 'number' && Math.floor(x) === x;
    return jt === t;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    var ta = jsonType(a);
    if (ta === null || ta !== jsonType(b)) return false;
    var i;
    if (ta === 'array') {
      if (a.length !== b.length) return false;
      for (i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    if (ta === 'object') {
      var ka = Object.keys(a);
      if (ka.length !== Object.keys(b).length) return false;
      for (i = 0; i < ka.length; i++) if (!hasOwn(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
      return true;
    }
    return false; // different scalars (=== already failed)
  }

  // A string that is equal for two values exactly when deepEqual says they are (keys sorted). Only called on values
  // that already passed jsonProblem, so the depth is bounded.
  function canonical(x) {
    var t = jsonType(x);
    if (t === 'array') return '[' + x.map(canonical).join(',') + ']';
    if (t === 'object') {
      return '{' + Object.keys(x).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canonical(x[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(x); // -0 → "0", as deepEqual (===) treats it
  }

  // First place where `value` is not exactly representable as JSON (iterative, so no stack overflow), or null.
  function jsonProblem(value) {
    var stack = [{ v: value, path: '', depth: 0 }];
    while (stack.length) {
      var item = stack.pop();
      var v = item.v;
      var t = jsonType(v);
      if (t === null) return { path: item.path, message: 'value cannot be written as JSON (' + describe(v) + ')' };
      if (t !== 'array' && t !== 'object') continue;
      if (item.depth >= MAX_DEPTH) return { path: item.path, message: 'nested deeper than ' + MAX_DEPTH + ' levels' };
      var keys = Object.keys(v);
      if (t === 'array' && keys.length !== v.length) return { path: item.path, message: 'array has holes or extra keys' };
      for (var i = keys.length - 1; i >= 0; i--) {
        var d = Object.getOwnPropertyDescriptor(v, keys[i]);
        var childPath = item.path + '/' + pointerEscape(keys[i]);
        if (!d || !hasOwn(d, 'value')) return { path: childPath, message: 'computed (getter) property' };
        stack.push({ v: d.value, path: childPath, depth: item.depth + 1 });
      }
    }
    return null;
  }

  function describe(v) {
    if (typeof v === 'number') return String(v);
    if (v === undefined) return 'undefined';
    if (typeof v === 'object') return 'not a plain object or array';
    return typeof v;
  }

  // Characters (code points), as Ajv counts them: an emoji is 1, a lone surrogate is 1.
  function charLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) i++;
      }
      n++;
    }
    return n;
  }

  function pointerEscape(key) {
    return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  /* ---------- compiling: check the schema once, resolve $ref, build regexes ---------- */

  function compile(rootSchema) {
    if (!isPlainObject(rootSchema)) fail('schema must be an object');
    var regexCache = Object.create(null);

    function regex(p) {
      if (typeof p !== 'string') fail('pattern must be a string');
      if (!(p in regexCache)) {
        try {
          regexCache[p] = new RegExp(p, 'u');
        } catch (e) {
          fail('invalid pattern "' + p + '": ' + e.message);
        }
      }
      return regexCache[p];
    }

    function resolve(ref) {
      if (typeof ref !== 'string' || ref.charAt(0) !== '#') fail('only local $ref is supported: ' + ref);
      if (ref === '#') return rootSchema;
      if (ref.charAt(1) !== '/') fail('unsupported $ref: ' + ref);
      var node = rootSchema;
      ref.slice(2).split('/').forEach(function (part) {
        var key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!isPlainObject(node) || !hasOwn(node, key)) fail('$ref not found: ' + ref);
        node = node[key];
      });
      return node;
    }

    // Walk every subschema once: unknown keywords, bad patterns and dangling refs fail here, not at check time.
    var seen = [];
    function checkSchema(s, where) {
      if (typeof s === 'boolean') return;
      if (!isPlainObject(s)) fail('subschema at ' + where + ' must be an object or boolean');
      if (seen.indexOf(s) !== -1) return;
      seen.push(s);
      Object.keys(s).forEach(function (k) {
        if (!hasOwn(KNOWN, k) && !hasOwn(IGNORED, k)) fail('unsupported keyword "' + k + '" at ' + where);
      });
      if (hasOwn(s, 'type')) {
        var ts = Array.isArray(s.type) ? s.type : [s.type];
        ts.forEach(function (t) {
          if (!hasOwn(TYPES, t)) fail('unknown type "' + t + '" at ' + where);
        });
      }
      if (hasOwn(s, 'pattern')) regex(s.pattern);
      if (hasOwn(s, '$id') && where !== '#') fail('$id is only allowed at the root (at ' + where + ')');
      if (hasOwn(s, 'type') && Array.isArray(s.type) && s.type.length === 0) fail('type must not be empty at ' + where);
      ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'].forEach(function (k) {
        if (hasOwn(s, k) && !(Number.isInteger(s[k]) && s[k] >= 0)) fail(k + ' must be a non-negative integer at ' + where);
      });
      ['minimum', 'maximum'].forEach(function (k) {
        if (hasOwn(s, k) && !(typeof s[k] === 'number' && isFinite(s[k]))) fail(k + ' must be a number at ' + where);
      });
      if (hasOwn(s, 'uniqueItems') && typeof s.uniqueItems !== 'boolean') fail('uniqueItems must be true or false at ' + where);
      if (hasOwn(s, 'enum') && Array.isArray(s.enum) && s.enum.length === 0) fail('enum must not be empty at ' + where);
      if (hasOwn(s, 'required') && Array.isArray(s.required) && s.required.some(function (r) { return typeof r !== 'string'; })) {
        fail('required must list strings at ' + where);
      }
      if (hasOwn(s, 'if') && !hasOwn(s, 'then') && !hasOwn(s, 'else')) fail('"if" without "then" or "else" at ' + where);
      if (hasOwn(s, 'enum') && !Array.isArray(s.enum)) fail('enum must be an array at ' + where);
      if (hasOwn(s, 'required') && !Array.isArray(s.required)) fail('required must be an array at ' + where);
      if (hasOwn(s, '$ref')) checkSchema(resolve(s.$ref), s.$ref);
      ['not', 'if', 'then', 'else', 'items', 'additionalProperties', 'propertyNames'].forEach(function (k) {
        if (hasOwn(s, k)) checkSchema(s[k], where + '/' + k);
      });
      if (hasOwn(s, 'anyOf')) {
        if (!Array.isArray(s.anyOf) || s.anyOf.length === 0) fail('anyOf must be a non-empty array at ' + where);
        s.anyOf.forEach(function (sub, i) {
          checkSchema(sub, where + '/anyOf/' + i);
        });
      }
      if (hasOwn(s, 'properties')) {
        if (!isPlainObject(s.properties)) fail('properties must be an object at ' + where);
        Object.keys(s.properties).forEach(function (k) {
          checkSchema(s.properties[k], where + '/properties/' + k);
        });
      }
      if (hasOwn(s, '$defs')) {
        Object.keys(s.$defs).forEach(function (k) {
          checkSchema(s.$defs[k], where + '/$defs/' + k);
        });
      }
    }
    checkSchema(rootSchema, '#');

    /* ---------- checking a value ---------- */

    // Appends errors for `x` (at `path`) against `s`; returns true when valid.
    function run(s, x, path, errors) {
      if (s === true) return true;
      if (s === false) {
        errors.push(err(path, 'false schema', 'nothing is allowed here', {}));
        return false;
      }
      var start = errors.length;
      var jt = jsonType(x);
      var i, k, keys;

      if (hasOwn(s, '$ref')) run(resolve(s.$ref), x, path, errors);

      if (hasOwn(s, 'type')) {
        var types = Array.isArray(s.type) ? s.type : [s.type];
        var okType = false;
        for (i = 0; i < types.length; i++) if (hasType(x, types[i])) okType = true;
        if (!okType) errors.push(err(path, 'type', 'must be ' + types.join(' or '), { type: s.type }));
      }
      if (hasOwn(s, 'const') && !deepEqual(x, s.const)) {
        errors.push(err(path, 'const', 'must be equal to constant', { allowedValue: s.const }));
      }
      if (hasOwn(s, 'enum')) {
        var inEnum = false;
        for (i = 0; i < s.enum.length; i++) if (deepEqual(x, s.enum[i])) inEnum = true;
        if (!inEnum) errors.push(err(path, 'enum', 'must be one of the allowed values', { allowedValues: s.enum }));
      }

      if (jt === 'number') {
        if (hasOwn(s, 'minimum') && !(x >= s.minimum)) errors.push(err(path, 'minimum', 'must be >= ' + s.minimum, { limit: s.minimum }));
        if (hasOwn(s, 'maximum') && !(x <= s.maximum)) errors.push(err(path, 'maximum', 'must be <= ' + s.maximum, { limit: s.maximum }));
      }

      if (jt === 'string') {
        var len = hasOwn(s, 'maxLength') || hasOwn(s, 'minLength') ? charLength(x) : 0;
        if (hasOwn(s, 'maxLength') && len > s.maxLength) errors.push(err(path, 'maxLength', 'must have at most ' + s.maxLength + ' characters', { limit: s.maxLength }));
        if (hasOwn(s, 'minLength') && len < s.minLength) errors.push(err(path, 'minLength', 'must have at least ' + s.minLength + ' characters', { limit: s.minLength }));
        if (hasOwn(s, 'pattern') && !regex(s.pattern).test(x)) errors.push(err(path, 'pattern', 'must match pattern "' + s.pattern + '"', { pattern: s.pattern }));
      }

      if (jt === 'array') {
        if (hasOwn(s, 'maxItems') && x.length > s.maxItems) errors.push(err(path, 'maxItems', 'must have at most ' + s.maxItems + ' items', { limit: s.maxItems }));
        if (hasOwn(s, 'minItems') && x.length < s.minItems) errors.push(err(path, 'minItems', 'must have at least ' + s.minItems + ' items', { limit: s.minItems }));
        if (hasOwn(s, 'items')) {
          for (i = 0; i < x.length && errors.length < MAX_ERRORS; i++) run(s.items, x[i], path + '/' + i, errors);
        }
        if (s.uniqueItems === true) {
          // As Ajv does: when the items schema itself names only simple types, items of another type are left out
          // of the duplicate check (they are already reported as a type error, so the verdict is the same).
          var itemTypes = isPlainObject(s.items) && hasOwn(s.items, 'type') ? [].concat(s.items.type) : [];
          var simple = itemTypes.length > 0 && itemTypes.indexOf('object') === -1 && itemTypes.indexOf('array') === -1;
          var counted = function (v) {
            if (!simple) return true;
            for (var q = 0; q < itemTypes.length; q++) if (hasType(v, itemTypes[q])) return true;
            return false;
          };
          var dup = null;
          var firstAt = Object.create(null);
          for (i = 0; i < x.length && !dup; i++) {
            if (!counted(x[i])) continue;
            var c = canonical(x[i]);
            if (c in firstAt) dup = { i: i, j: firstAt[c] };
            else firstAt[c] = i;
          }
          if (dup) errors.push(err(path, 'uniqueItems', 'must not have duplicate items (items ' + dup.j + ' and ' + dup.i + ')', dup));
        }
      }

      if (jt === 'object') {
        keys = Object.keys(x);
        if (hasOwn(s, 'maxProperties') && keys.length > s.maxProperties) errors.push(err(path, 'maxProperties', 'must have at most ' + s.maxProperties + ' properties', { limit: s.maxProperties }));
        if (hasOwn(s, 'minProperties') && keys.length < s.minProperties) errors.push(err(path, 'minProperties', 'must have at least ' + s.minProperties + ' properties', { limit: s.minProperties }));
        if (hasOwn(s, 'required')) {
          for (i = 0; i < s.required.length; i++) {
            if (!hasOwn(x, s.required[i])) errors.push(err(path, 'required', 'must have property "' + s.required[i] + '"', { missingProperty: s.required[i] }));
          }
        }
        if (hasOwn(s, 'propertyNames')) {
          for (i = 0; i < keys.length && errors.length < MAX_ERRORS; i++) {
            var sub = [];
            if (!run(s.propertyNames, keys[i], path, sub)) {
              for (k = 0; k < sub.length; k++) {
                sub[k].params.propertyName = keys[i];
                errors.push(sub[k]);
              }
              errors.push(err(path, 'propertyNames', 'property name "' + keys[i] + '" is invalid', { propertyName: keys[i] }));
            }
          }
        }
        var props = hasOwn(s, 'properties') ? s.properties : null;
        for (i = 0; i < keys.length && errors.length < MAX_ERRORS; i++) {
          k = keys[i];
          var childPath = path + '/' + pointerEscape(k);
          if (props && hasOwn(props, k)) {
            run(props[k], x[k], childPath, errors);
          } else if (hasOwn(s, 'additionalProperties')) {
            if (s.additionalProperties === false) {
              errors.push(err(path, 'additionalProperties', 'unknown property "' + k + '"', { additionalProperty: k }));
            } else {
              run(s.additionalProperties, x[k], childPath, errors);
            }
          }
        }
      }

      if (hasOwn(s, 'anyOf')) {
        var branchErrors = [];
        var anyOk = false;
        for (i = 0; i < s.anyOf.length && !anyOk; i++) {
          var be = [];
          if (run(s.anyOf[i], x, path, be)) anyOk = true;
          else branchErrors = branchErrors.concat(be);
        }
        if (!anyOk) {
          for (i = 0; i < branchErrors.length; i++) errors.push(branchErrors[i]);
          errors.push(err(path, 'anyOf', 'must match a schema in anyOf', {}));
        }
      }
      if (hasOwn(s, 'not') && run(s.not, x, path, [])) {
        errors.push(err(path, 'not', 'must NOT be valid', {}));
      }
      if (hasOwn(s, 'if') && (hasOwn(s, 'then') || hasOwn(s, 'else'))) {
        var cond = run(s['if'], x, path, []);
        var branch = cond ? 'then' : 'else';
        if (hasOwn(s, branch) && !run(s[branch], x, path, errors)) {
          errors.push(err(path, 'if', 'must match "' + branch + '" schema', { failingKeyword: branch }));
        }
      }

      return errors.length === start;
    }

    return function (value) {
      var errors = [];
      try {
        var problem = jsonProblem(value);
        if (problem) return { valid: false, errors: [err(problem.path, 'json', problem.message, {})] };
        run(rootSchema, value, '', errors);
      } catch (e) {
        // Not expected for parsed JSON (depth is bounded); live values such as a revoked Proxy can still throw.
        return { valid: false, errors: [err('', 'limit', 'document could not be checked: ' + e.message, {})] };
      }
      if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
      return { valid: errors.length === 0, errors: errors };
    };
  }

  function err(instancePath, keyword, message, params) {
    return { instancePath: instancePath, keyword: keyword, message: message, params: params };
  }

  /* ---------- the three Hawiya schemas ---------- */

  var NAMES = ['identity', 'template', 'session'];
  var compiled = Object.create(null);

  function validatorFor(name) {
    if (NAMES.indexOf(name) === -1) fail('unknown schema "' + name + '" (expected identity, template or session)');
    if (!compiled[name]) {
      if (!SCHEMAS || !SCHEMAS[name]) fail('schemas.js is not loaded (load it before validate.js)');
      compiled[name] = compile(SCHEMAS[name]);
    }
    return compiled[name];
  }

  function check(name, value) {
    return validatorFor(name)(value);
  }

  // JSON text → verdict. Text that is not JSON (NaN, Infinity, trailing commas, ...) is rejected.
  function checkText(name, text) {
    var v = validatorFor(name);
    if (typeof text !== 'string') return { valid: false, errors: [err('', 'json', 'expected JSON text', {})] };
    var value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      return { valid: false, errors: [err('', 'json', 'not valid JSON: ' + e.message, {})] };
    }
    var dupKey = duplicateKey(text);
    if (dupKey) return { valid: false, errors: [err(dupKey.path, 'duplicateKey', 'the key "' + dupKey.key + '" appears twice', { key: dupKey.key })] };
    return v(value);
  }

  // Scans text that JSON.parse has already accepted; returns the first object key that appears twice, or null.
  function duplicateKey(text) {
    var stack = []; // { obj: bool, path, keys, lastKey, index, expectKey }
    var top = null;
    var pending = ''; // path of the value about to start
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '"') {
        var j = i + 1;
        while (text.charAt(j) !== '"') j += text.charAt(j) === '\\' ? 2 : 1;
        if (top && top.obj && top.expectKey) {
          var key = JSON.parse(text.slice(i, j + 1));
          if (hasOwn(top.keys, key)) return { path: top.path, key: key };
          top.keys[key] = 1;
          top.lastKey = key;
          top.expectKey = false;
        }
        i = j;
      } else if (ch === '{' || ch === '[') {
        var path = top ? top.path + '/' + pointerEscape(top.obj ? top.lastKey : top.index) : pending;
        if (stack.length >= MAX_DEPTH) return null; // too deep: check() rejects it (jsonProblem), no need to go on
        top = { obj: ch === '{', path: path, keys: Object.create(null), lastKey: '', index: 0, expectKey: true };
        stack.push(top);
      } else if (ch === '}' || ch === ']') {
        stack.pop();
        top = stack.length ? stack[stack.length - 1] : null;
      } else if (ch === ',' && top) {
        if (top.obj) top.expectKey = true;
        else top.index++;
      }
    }
    return null;
  }

  return { NAMES: NAMES, MAX_DEPTH: MAX_DEPTH, MAX_ERRORS: MAX_ERRORS, compile: compile, check: check, checkText: checkText, charLength: charLength, deepEqual: deepEqual, duplicateKey: duplicateKey };
});
