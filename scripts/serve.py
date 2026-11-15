#!/usr/bin/env python3
"""
Hawiya save server (Python 3.8+, standard library only). Same contract as scripts/serve.js.

Usage: python3 -I scripts/serve.py <project-dir> [--idle-timeout <seconds>]

- Serves the picker page on 127.0.0.1 at a random port.
- Prints one JSON line when ready:
  {"status":"ready","url":"http://127.0.0.1:<port>/#token=<token>","existing":[...]}
- Accepts one export (POST /api/export) carrying the one-time token in the X-Hawiya-Token header,
  writes only fixed file names into <project-dir>/design/, never replaces existing files,
  prints {"status":"saved","written":[...]} and exits 0.
- Exits 1 with {"status":"closed","reason":...} after the idle timeout or 5 failed token attempts.
- Exits 2 on bad arguments.

Also holds the Python identity checker (task 1.13): check_document / check_document_text, a port of
picker/js/core/validate.js. Until task 1.14 the server itself still runs the phase-0 prototype contract.
"""

import errno
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import socket
import socketserver
import stat
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ALLOWED_FILES = ["identity.json", "DESIGN.md", "tokens.json", "tokens.css", "theme.css", "style-guide.html"]
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_FAILED_ATTEMPTS = 5
DEFAULT_IDLE_SECONDS = 3600
SOCKET_TIMEOUT_SECONDS = 10  # per read/write on a connection
REQUEST_DEADLINE_SECONDS = 30  # whole request, including slow headers or a trickled body
LINGER_SECONDS = 1.0  # after refusing a request, briefly drain so the client can read the reply
LINGER_MAX_BYTES = 8 * 1024 * 1024

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
}

BASE_HEADERS = [
    ("Cache-Control", "no-store"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
]


# ---------- output ----------

_print_lock = threading.Lock()


def print_line(obj):
    """Best effort: a closed stdout (the agent stopped reading) must never stop the server from exiting."""
    with _print_lock:
        try:
            sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
        except (OSError, ValueError):
            pass


def die(message):
    sys.stderr.write("hawiya serve: " + message + "\n")
    sys.stderr.flush()
    sys.exit(2)


# ---------- arguments ----------

def parse_args(argv):
    project_arg = None
    idle_seconds = DEFAULT_IDLE_SECONDS
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--idle-timeout":
            i += 1
            try:
                v = int(argv[i]) if i < len(argv) else None
            except ValueError:
                v = None
            if v is None or v < 1 or v > 86400:
                die("--idle-timeout must be an integer between 1 and 86400")
            idle_seconds = v
        elif a.startswith("--"):
            die("unknown option " + a)
        elif project_arg is None:
            project_arg = a
        else:
            die("only one project directory may be given")
        i += 1
    if project_arg is None:
        die("usage: serve.py <project-dir> [--idle-timeout <seconds>]")
    if not os.path.exists(project_arg):
        die("project directory does not exist: " + project_arg)
    project = os.path.realpath(project_arg)
    if not os.path.isdir(project):
        die("not a directory: " + project_arg)
    return project, idle_seconds


# ---------- shared state ----------

class State(object):
    def __init__(self):
        self.lock = threading.Lock()
        # Serialises "write the files" against "decide to close": a save is never cut in half by an exit,
        # and nothing is written once the server has decided to close. Re-entrant: finish() may run under it.
        self.write_lock = threading.RLock()
        self.finished = False
        self.closing = False  # set the moment a close is decided, before the triggering reply is sent
        self.failed_attempts = 0
        self.token_used = False
        self.idle_timer = None
        self.idle_seconds = DEFAULT_IDLE_SECONDS
        self.project = None
        self.design_dir = None
        self.picker_root = None
        self.token_digest = None
        self.expected_host = None
        self.origin = None


S = State()


def finish(code, info):
    with S.write_lock:  # wait for any save in progress; then the decision is final
        with S.lock:
            if S.finished:
                return
            if code != 0 and S.token_used:
                return  # files were just saved; that save reports "saved" and exits 0 itself
            S.finished = True
            S.closing = True
            if S.idle_timer is not None:
                S.idle_timer.cancel()

    def stop():
        time.sleep(0.05)  # let the response that triggered this finish leave the socket
        S.write_lock.acquire(timeout=5)  # never exit in the middle of writing files
        os._exit(code)

    # Print first (print_line never raises), then schedule the exit: the line cannot be lost.
    line = {"status": "saved" if code == 0 else "closed"}
    line.update(info)
    print_line(line)
    threading.Thread(target=stop, daemon=True).start()


def touch():
    with S.lock:
        if S.finished:
            return
        if S.idle_timer is not None:
            S.idle_timer.cancel()
        t = threading.Timer(S.idle_seconds, lambda: finish(1, {"reason": "idle timeout"}))
        t.daemon = True
        t.start()
        S.idle_timer = t


def token_matches(values):
    # Exactly one header value, bounded length, constant-time comparison of digests.
    if not values or len(values) != 1:
        return False
    given = values[0]
    if not isinstance(given, str) or len(given) == 0 or len(given) > 256:
        return False
    digest = hashlib.sha256(given.encode("utf-8", "surrogatepass")).digest()
    return hmac.compare_digest(digest, S.token_digest)


# ---------- filesystem helpers ----------

def lstat_or_none(p):
    try:
        return os.lstat(p)
    except OSError:
        return None


def err_code(e):
    if isinstance(e, OSError) and e.errno in errno.errorcode:
        return errno.errorcode[e.errno]
    return str(e)


def existing_design_files():
    st = lstat_or_none(S.design_dir)
    if st is None or not stat.S_ISDIR(st.st_mode):
        return []
    return [n for n in ALLOWED_FILES if lstat_or_none(os.path.join(S.design_dir, n)) is not None]


def design_is_plain_folder():
    """design must be a real folder directly inside the project (not a link, not swapped for one)."""
    st = lstat_or_none(S.design_dir)
    if st is None or stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
        return False
    try:
        return os.path.realpath(S.design_dir) == S.design_dir
    except OSError:
        return False


# ---------- export ----------

def _reject_constant(name):
    raise ValueError("not valid JSON: " + name)


def strict_json_loads(text):
    """Standard JSON only, like JavaScript's JSON.parse: no NaN/Infinity. Numbers are not converted
    (keeps huge integers cheap and accepted, as in Node; the server never uses their values)."""
    return json.loads(text, parse_constant=_reject_constant, parse_int=str, parse_float=str)


_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def to_utf8(text):
    # json.loads already joined valid surrogate pairs; any left are lone halves. Write U+FFFD like Node.
    return _LONE_SURROGATE.sub("�", text).encode("utf-8")



# ---------- identity / template / session checker (task 1.13) ----------
#
# A port of picker/js/core/validate.js, the checker the page and the Node server use (task 1.7). It must accept and
# reject exactly what that one does (tests/server/python-validate.test.js compares them on every shared sample and
# thousands of variations). Standard library only. The rules are the schemas in schema/*.json themselves.
#
#   check_document(name, value)  -> {"valid": bool, "errors": [{"instancePath", "keyword", "message", "params"}]}
#   check_document_text(name, text)  same, after a strict parse (NaN/Infinity text, duplicate keys and
#                                     numbers too large for a double are rejected, as in JavaScript)
#
# Differences between the two languages that are handled on purpose:
# - Patterns are written for JavaScript (flag "u"); _js_pattern translates them: "$" only matches at the very end
#   (Python's "$" also matches before a final newline), "\d" is ASCII 0-9 and "\s" is JavaScript's whitespace set.
# - JSON numbers are read as doubles, like JavaScript (huge integers round, 1e400 becomes infinite and is rejected).
# - true/false are booleans, never the numbers 1/0 (in Python bool is a kind of int).
# - Text length counts characters the JavaScript way (a surrogate pair is one character).
# - Object keys are visited in JavaScript's order (integer-like keys first).

CHECK_NAMES = ("identity", "template", "session")
CHECK_MAX_DEPTH = 200
CHECK_MAX_ERRORS = 100
_SCHEMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "schema")
_IGNORED_KEYWORDS = {"$schema", "$id", "$defs", "title", "description"}
_KNOWN_KEYWORDS = {
    "type", "const", "enum", "$ref", "anyOf", "not", "if", "then", "else",
    "minLength", "maxLength", "pattern", "minimum", "maximum",
    "items", "minItems", "maxItems", "uniqueItems",
    "properties", "required", "additionalProperties", "propertyNames", "minProperties", "maxProperties",
}
_TYPES = {"null", "boolean", "object", "array", "number", "integer", "string"}

# JavaScript's \s: tab, LF, VT, FF, CR, space, NBSP, U+1680, U+2000-U+200A, LS, PS, NNBSP, MMSP, ideographic space, BOM
_JS_SPACE = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680] + list(range(0x2000, 0x200B)) + [0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
_JS_SPACE_CLASS = "".join("\\x%02x" % c if c < 0x100 else "\\" + "u%04x" % c for c in _JS_SPACE)
_JS_LINE_END_CLASS = "\\x0a\\x0d\\" + "u2028\\" + "u2029"


class SchemaError(Exception):
    pass


def _js_pattern(p):
    """Translates a JavaScript (u-flag) regular expression into a Python one with the same meaning."""
    out = []
    in_class = False
    i = 0
    while i < len(p):
        ch = p[i]
        if ch == "\\":
            if i + 1 >= len(p):
                raise SchemaError("pattern ends with a backslash: " + p)
            nxt = p[i + 1]
            if nxt == "d":
                out.append("0-9" if in_class else "[0-9]")
            elif nxt == "D":
                if in_class:
                    raise SchemaError("\\D inside a class is not supported: " + p)
                out.append("[^0-9]")
            elif nxt == "s":
                out.append(_JS_SPACE_CLASS if in_class else "[" + _JS_SPACE_CLASS + "]")
            elif nxt == "S":
                if in_class:
                    raise SchemaError("\\S inside a class is not supported: " + p)
                out.append("[^" + _JS_SPACE_CLASS + "]")
            elif nxt == "u":
                hexpart = p[i + 2:i + 6]
                if len(hexpart) != 4 or any(c not in "0123456789abcdefABCDEF" for c in hexpart):
                    raise SchemaError("unsupported \\u escape: " + p)
                hi = int(hexpart, 16)
                lo_part = p[i + 8:i + 12] if p[i + 6:i + 8] == "\\" + "u" else ""
                if 0xD800 <= hi <= 0xDBFF and len(lo_part) == 4 and all(c in "0123456789abcdefABCDEF" for c in lo_part) and 0xDC00 <= int(lo_part, 16) <= 0xDFFF:
                    # with the u flag an escaped surrogate pair is one character
                    out.append("\\" + "U%08x" % (0x10000 + ((hi - 0xD800) << 10) + (int(lo_part, 16) - 0xDC00)))
                    i += 12
                    continue
                out.append("\\" + "u" + hexpart)
                i += 6
                continue
            elif nxt == "-" and not in_class:
                raise SchemaError("\\- outside a class is a syntax error with the u flag: " + p)
            elif nxt in ".-^$*+?()[]{}|/\\":
                out.append("\\" + nxt)
            elif nxt in "tnrfv":
                out.append("\\" + nxt)
            else:
                raise SchemaError("unsupported escape \\%s in pattern: %s" % (nxt, p))
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            out.append(ch)
        elif ch == "[":
            in_class = True
            out.append(ch)
            if p[i + 1:i + 2] == "^":
                out.append("^")
                i += 1
        elif ch == "$":
            out.append("\\Z")
        elif ch == ".":
            out.append("[^" + _JS_LINE_END_CLASS + "]")
        else:
            out.append(ch)
        i += 1
    return re.compile("".join(out))


# ----- JSON values -----

def _json_type(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "boolean"
    if isinstance(x, float):
        return "number" if math.isfinite(x) else None
    if isinstance(x, int):
        try:
            return "number" if math.isfinite(float(x)) else None
        except OverflowError:
            return None
    if isinstance(x, str):
        return "string"
    if isinstance(x, list):
        return "array"
    if isinstance(x, dict):
        return "object"
    return None


def _has_type(x, t):
    jt = _json_type(x)
    if t == "integer":
        return jt == "number" and float(x).is_integer()
    return jt == t


def _deep_equal(a, b):
    ta = _json_type(a)
    if ta is None or ta != _json_type(b):
        return False
    if ta == "number":
        return float(a) == float(b)  # -0 equals 0, as in JavaScript
    if ta == "array":
        return len(a) == len(b) and all(_deep_equal(x, y) for x, y in zip(a, b))
    if ta == "object":
        return len(a) == len(b) and all(k in b and _deep_equal(a[k], b[k]) for k in a)
    return a == b


def _canonical(x):
    t = _json_type(x)
    if t == "array":
        return "[" + ",".join(_canonical(v) for v in x) + "]"
    if t == "object":
        return "{" + ",".join(json.dumps(k) + ":" + _canonical(x[k]) for k in sorted(x)) + "}"
    if t == "number":
        return "n" + repr(float(x) + 0.0)  # + 0.0 turns -0.0 into 0.0
    return t[0] + json.dumps(x)


def _char_length(s):
    """Characters as JavaScript counts them: a high surrogate followed by a low one is one character."""
    n = 0
    i = 0
    while i < len(s):
        c = ord(s[i])
        if 0xD800 <= c <= 0xDBFF and i + 1 < len(s) and 0xDC00 <= ord(s[i + 1]) <= 0xDFFF:
            i += 1
        n += 1
        i += 1
    return n


def _pointer_escape(key):
    return str(key).replace("~", "~0").replace("/", "~1")


def _is_index_key(k):
    # at most 10 digits before int(): long digit strings would be slow or refused by int()
    return 0 < len(k) <= 10 and k.isascii() and k.isdigit() and (k == "0" or not k.startswith("0")) and int(k) < 4294967295


def _js_keys(obj):
    """Object.keys order: integer-like keys ascending, then the rest in insertion order."""
    idx = sorted((k for k in obj if _is_index_key(k)), key=int)
    return idx + [k for k in obj if not _is_index_key(k)]


def _err(path, keyword, message, params=None):
    return {"instancePath": path, "keyword": keyword, "message": message, "params": params or {}}


def _json_problem(value):
    stack = [(value, "", 0)]
    while stack:
        v, path, depth = stack.pop()
        t = _json_type(v)
        if t is None:
            return {"path": path, "message": "value cannot be written as JSON"}
        if t not in ("array", "object"):
            continue
        if depth >= CHECK_MAX_DEPTH:
            return {"path": path, "message": "nested deeper than %d levels" % CHECK_MAX_DEPTH}
        if t == "array":
            for i in range(len(v) - 1, -1, -1):
                stack.append((v[i], path + "/" + str(i), depth + 1))
        else:
            if any(not isinstance(k, str) for k in v):
                return {"path": path, "message": "value cannot be written as JSON (object key that is not text)"}
            keys = _js_keys(v)
            for k in reversed(keys):
                stack.append((v[k], path + "/" + _pointer_escape(k), depth + 1))
    return None


# ----- compiling a schema -----

class _Compiled(object):
    def __init__(self, root):
        if not isinstance(root, dict):
            raise SchemaError("schema must be an object")
        self.root = root
        self.regex = {}
        self._seen = set()
        self._check_schema(root, "#")

    def resolve(self, ref):
        if not isinstance(ref, str) or not ref.startswith("#"):
            raise SchemaError("only local $ref is supported: %r" % (ref,))
        if ref == "#":
            return self.root
        if not ref.startswith("#/"):
            raise SchemaError("unsupported $ref: " + ref)
        node = self.root
        for part in ref[2:].split("/"):
            key = part.replace("~1", "/").replace("~0", "~")
            if not isinstance(node, dict) or key not in node:
                raise SchemaError("$ref not found: " + ref)
            node = node[key]
        return node

    def pattern(self, p):
        if p not in self.regex:
            if not isinstance(p, str):
                raise SchemaError("pattern must be a string")
            try:
                self.regex[p] = _js_pattern(p)
            except re.error as e:
                raise SchemaError("invalid pattern %r: %s" % (p, e))
        return self.regex[p]

    def _check_schema(self, s, where):
        if isinstance(s, bool):
            return
        if not isinstance(s, dict):
            raise SchemaError("subschema at %s must be an object or boolean" % where)
        if id(s) in self._seen:
            return
        self._seen.add(id(s))
        for k in s:
            if k not in _KNOWN_KEYWORDS and k not in _IGNORED_KEYWORDS:
                raise SchemaError('unsupported keyword "%s" at %s' % (k, where))
        if "type" in s:
            ts = s["type"] if isinstance(s["type"], list) else [s["type"]]
            if any(not isinstance(t, str) for t in ts):
                raise SchemaError("type must be a name or a list of names at " + where)
            if not ts:
                raise SchemaError("type must not be empty at " + where)
            for t in ts:
                if t not in _TYPES:
                    raise SchemaError('unknown type "%s" at %s' % (t, where))
        if "pattern" in s:
            self.pattern(s["pattern"])
        if "$id" in s and where != "#":
            raise SchemaError("$id is only allowed at the root (at %s)" % where)
        for k in ("minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"):
            if k in s and not (_json_type(s[k]) == "number" and float(s[k]).is_integer() and s[k] >= 0):
                raise SchemaError("%s must be a non-negative integer at %s" % (k, where))
        for k in ("minimum", "maximum"):
            if k in s and not (_json_type(s[k]) == "number"):
                raise SchemaError("%s must be a number at %s" % (k, where))
        if "uniqueItems" in s and not isinstance(s["uniqueItems"], bool):
            raise SchemaError("uniqueItems must be true or false at " + where)
        if "enum" in s and (not isinstance(s["enum"], list) or not s["enum"]):
            raise SchemaError("enum must be a non-empty array at " + where)
        if "required" in s and (not isinstance(s["required"], list) or any(not isinstance(r, str) for r in s["required"])):
            raise SchemaError("required must list strings at " + where)
        if "if" in s and "then" not in s and "else" not in s:
            raise SchemaError('"if" without "then" or "else" at ' + where)
        if "$ref" in s:
            self._check_schema(self.resolve(s["$ref"]), s["$ref"])
        for k in ("not", "if", "then", "else", "items", "additionalProperties", "propertyNames"):
            if k in s:
                self._check_schema(s[k], where + "/" + k)
        if "anyOf" in s:
            if not isinstance(s["anyOf"], list) or not s["anyOf"]:
                raise SchemaError("anyOf must be a non-empty array at " + where)
            for i, sub in enumerate(s["anyOf"]):
                self._check_schema(sub, "%s/anyOf/%d" % (where, i))
        if "properties" in s:
            if not isinstance(s["properties"], dict):
                raise SchemaError("properties must be an object at " + where)
            for k, sub in s["properties"].items():
                self._check_schema(sub, where + "/properties/" + k)
        if "$defs" in s:
            for k, sub in s["$defs"].items():
                self._check_schema(sub, where + "/$defs/" + k)

    # Appends errors for x (at path) against s; returns True when valid. Mirrors validate.js run().
    def run(self, s, x, path, errors):
        if s is True:
            return True
        if s is False:
            errors.append(_err(path, "false schema", "nothing is allowed here"))
            return False
        start = len(errors)
        jt = _json_type(x)

        if "$ref" in s:
            self.run(self.resolve(s["$ref"]), x, path, errors)

        if "type" in s:
            types = s["type"] if isinstance(s["type"], list) else [s["type"]]
            if not any(_has_type(x, t) for t in types):
                errors.append(_err(path, "type", "must be " + " or ".join(types), {"type": s["type"]}))
        if "const" in s and not _deep_equal(x, s["const"]):
            errors.append(_err(path, "const", "must be equal to constant"))
        if "enum" in s and not any(_deep_equal(x, e) for e in s["enum"]):
            errors.append(_err(path, "enum", "must be one of the allowed values"))

        if jt == "number":
            if "minimum" in s and not (float(x) >= s["minimum"]):
                errors.append(_err(path, "minimum", "must be >= %s" % s["minimum"]))
            if "maximum" in s and not (float(x) <= s["maximum"]):
                errors.append(_err(path, "maximum", "must be <= %s" % s["maximum"]))

        if jt == "string":
            n = _char_length(x) if ("maxLength" in s or "minLength" in s) else 0
            if "maxLength" in s and n > s["maxLength"]:
                errors.append(_err(path, "maxLength", "must have at most %d characters" % s["maxLength"]))
            if "minLength" in s and n < s["minLength"]:
                errors.append(_err(path, "minLength", "must have at least %d characters" % s["minLength"]))
            if "pattern" in s and not self.pattern(s["pattern"]).search(x):
                errors.append(_err(path, "pattern", 'must match pattern "%s"' % s["pattern"]))

        if jt == "array":
            if "maxItems" in s and len(x) > s["maxItems"]:
                errors.append(_err(path, "maxItems", "must have at most %d items" % s["maxItems"]))
            if "minItems" in s and len(x) < s["minItems"]:
                errors.append(_err(path, "minItems", "must have at least %d items" % s["minItems"]))
            if "items" in s:
                for i, item in enumerate(x):
                    if len(errors) >= CHECK_MAX_ERRORS:
                        break
                    self.run(s["items"], item, path + "/" + str(i), errors)
            if s.get("uniqueItems") is True:
                # As Ajv: when the items schema itself names only simple types, other types are left out.
                items = s.get("items")
                item_types = []
                if isinstance(items, dict) and "type" in items:
                    item_types = items["type"] if isinstance(items["type"], list) else [items["type"]]
                simple = bool(item_types) and "object" not in item_types and "array" not in item_types
                first = {}
                dup = None
                for i, item in enumerate(x):
                    if simple and not any(_has_type(item, t) for t in item_types):
                        continue
                    key = _canonical(item)
                    if key in first:
                        dup = {"i": i, "j": first[key]}
                        break
                    first[key] = i
                if dup:
                    errors.append(_err(path, "uniqueItems", "must not have duplicate items (items %d and %d)" % (dup["j"], dup["i"]), dup))

        if jt == "object":
            keys = _js_keys(x)
            if "maxProperties" in s and len(keys) > s["maxProperties"]:
                errors.append(_err(path, "maxProperties", "must have at most %d properties" % s["maxProperties"]))
            if "minProperties" in s and len(keys) < s["minProperties"]:
                errors.append(_err(path, "minProperties", "must have at least %d properties" % s["minProperties"]))
            for r in s.get("required", []):
                if r not in x:
                    errors.append(_err(path, "required", 'must have property "%s"' % r, {"missingProperty": r}))
            if "propertyNames" in s:
                for k in keys:
                    if len(errors) >= CHECK_MAX_ERRORS:
                        break
                    sub = []
                    if not self.run(s["propertyNames"], k, path, sub):
                        for e in sub:
                            e["params"]["propertyName"] = k
                            errors.append(e)
                        errors.append(_err(path, "propertyNames", 'property name "%s" is invalid' % k, {"propertyName": k}))
            props = s.get("properties")
            for k in keys:
                if len(errors) >= CHECK_MAX_ERRORS:
                    break
                child = path + "/" + _pointer_escape(k)
                if props is not None and k in props:
                    self.run(props[k], x[k], child, errors)
                elif "additionalProperties" in s:
                    if s["additionalProperties"] is False:
                        errors.append(_err(path, "additionalProperties", 'unknown property "%s"' % k, {"additionalProperty": k}))
                    else:
                        self.run(s["additionalProperties"], x[k], child, errors)

        if "anyOf" in s:
            branch_errors = []
            ok = False
            for sub in s["anyOf"]:
                be = []
                if self.run(sub, x, path, be):
                    ok = True
                    break
                branch_errors.extend(be)
            if not ok:
                errors.extend(branch_errors)
                errors.append(_err(path, "anyOf", "must match a schema in anyOf"))
        if "not" in s and self.run(s["not"], x, path, []):
            errors.append(_err(path, "not", "must NOT be valid"))
        if "if" in s and ("then" in s or "else" in s):
            cond = self.run(s["if"], x, path, [])
            branch = "then" if cond else "else"
            if branch in s and not self.run(s[branch], x, path, errors):
                errors.append(_err(path, "if", 'must match "%s" schema' % branch, {"failingKeyword": branch}))

        return len(errors) == start

    def check(self, value):
        try:
            problem = _json_problem(value)
            if problem:
                return {"valid": False, "errors": [_err(problem["path"], "json", problem["message"])]}
            errors = []
            self.run(self.root, value, "", errors)
        except (RecursionError, MemoryError) as e:
            return {"valid": False, "errors": [_err("", "limit", "document could not be checked: " + type(e).__name__)]}
        return {"valid": not errors, "errors": errors[:CHECK_MAX_ERRORS]}


_compiled = {}


def compile_schema(schema):
    return _Compiled(schema)


def _validator_for(name):
    if name not in CHECK_NAMES:
        raise SchemaError('unknown schema "%s" (expected identity, template or session)' % name)
    if name not in _compiled:
        with open(os.path.join(_SCHEMA_DIR, name + ".schema.json"), "r", encoding="utf-8") as f:
            _compiled[name] = _Compiled(json.load(f))
    return _compiled[name]


def check_document(name, value):
    return _validator_for(name).check(value)


def _reject_json_constant(name):
    raise ValueError("not JSON: " + name)


def _duplicate_key(text):
    """Port of validate.js duplicateKey(): first object key written twice in text JSON already accepted, or None."""
    stack = []
    top = None
    pending = ""
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            if top is not None and top["obj"] and top["expect_key"]:
                key = _join_surrogates(json.loads(text[i:j + 1]))
                if key in top["keys"]:
                    return {"path": top["path"], "key": key}
                top["keys"].add(key)
                top["last_key"] = key
                top["expect_key"] = False
            i = j
        elif ch in "{[":
            if len(stack) >= CHECK_MAX_DEPTH:
                return None
            if top is not None:
                path = top["path"] + "/" + _pointer_escape(top["last_key"] if top["obj"] else top["index"])
            else:
                path = pending
            top = {"obj": ch == "{", "path": path, "keys": set(), "last_key": "", "index": 0, "expect_key": True}
            stack.append(top)
        elif ch in "}]":
            stack.pop()
            top = stack[-1] if stack else None
        elif ch == "," and top is not None:
            if top["obj"]:
                top["expect_key"] = True
            else:
                top["index"] += 1
        i += 1
    return None


_SURROGATE = re.compile("[" + "\\" + "ud800-" + "\\" + "udfff]")


def _join_surrogates(s):
    # JavaScript strings are UTF-16 units: a raw high surrogate followed by an (escaped) low one is one character.
    return s.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass") if _SURROGATE.search(s) else s


def _join_all(v):
    if isinstance(v, str):
        return _join_surrogates(v)
    if isinstance(v, list):
        return [_join_all(x) for x in v]
    if isinstance(v, dict):
        return {_join_surrogates(k): _join_all(x) for k, x in v.items()}
    return v


def check_document_text(name, text):
    v = _validator_for(name)
    if not isinstance(text, str):
        return {"valid": False, "errors": [_err("", "json", "expected JSON text")]}
    try:
        # float() reads any JSON number as JavaScript does (correctly rounded double, +-inf beyond the range) in
        # linear time; int() would be quadratic on old Pythons and refuses more than 4300 digits on new ones.
        value = json.loads(text, parse_constant=_reject_json_constant, parse_int=float, parse_float=float)
    except (ValueError, RecursionError) as e:
        return {"valid": False, "errors": [_err("", "json", "not valid JSON: " + type(e).__name__)]}
    if _SURROGATE.search(text):
        try:
            value = _join_all(value)
        except RecursionError:
            return {"valid": False, "errors": [_err("", "json", "not valid JSON: RecursionError")]}
    dup = _duplicate_key(text)
    if dup:
        return {"valid": False, "errors": [_err(dup["path"], "duplicateKey", 'the key "%s" appears twice' % dup["key"], {"key": dup["key"]})]}
    return v.check(value)


def validate_export(payload):
    if not isinstance(payload, dict):
        return "body must be a JSON object"
    files = payload.get("files")
    if not isinstance(files, dict):
        return '"files" must be an object'
    if len(files) == 0:
        return '"files" is empty'
    for name, content in files.items():
        if name not in ALLOWED_FILES:
            return "file name not allowed: " + name
        if not isinstance(content, str):
            return "content of " + name + " must be a string"
    if "identity.json" in files:
        try:
            parsed = strict_json_loads(files["identity.json"])
        except (ValueError, RecursionError):
            return "identity.json is not valid JSON"
        if not isinstance(parsed, dict):
            return "identity.json must be a JSON object"
    return None


def write_export(files):
    """Returns (status, body) on refusal, or (None, written_names) on success. Never writes outside design/."""
    st = lstat_or_none(S.design_dir)
    if st is not None and not design_is_plain_folder():
        return 409, {"error": "design exists but is not a plain folder; refusing to write"}
    if st is None:
        try:
            os.mkdir(S.design_dir)
        except OSError as e:
            return 500, {"error": "cannot create the design folder: " + err_code(e)}
    if not design_is_plain_folder():
        return 409, {"error": "design is not a plain folder"}

    names = list(files.keys())
    clash = [n for n in names if lstat_or_none(os.path.join(S.design_dir, n)) is not None]
    if clash:
        return 409, {"error": "files already exist; not replacing", "existing": clash}

    temps = []
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        for name in names:
            if not design_is_plain_folder():
                raise RuntimeError("design folder changed during write")
            tmp = os.path.join(S.design_dir, "." + name + "." + secrets.token_hex(6) + ".tmp")
            fd = os.open(tmp, flags, 0o644)
            temps.append((tmp, os.path.join(S.design_dir, name)))
            with os.fdopen(fd, "wb") as fh:
                fh.write(to_utf8(files[name]))
        for tmp, final in temps:
            if not design_is_plain_folder():
                raise RuntimeError("design folder changed during write")
            if lstat_or_none(final) is not None:
                raise RuntimeError("file appeared during write: " + os.path.basename(final))
            os.rename(tmp, final)
    except (OSError, RuntimeError, UnicodeError) as e:
        for tmp, _ in temps:
            try:
                os.unlink(tmp)
            except OSError:
                pass  # already renamed or gone
        return 500, {"error": "write failed: " + err_code(e)}
    return None, names


# ---------- HTTP ----------

class BadFraming(Exception):
    """The request body framing is ambiguous or invalid; refuse and close (anti request-smuggling)."""


_DIGITS = re.compile(r"^[0-9]+$")
_CHUNK_SIZE = re.compile(rb"^([0-9A-Fa-f]{1,8})(;[^\r\n]*)?\r\n$")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Hawiya"
    sys_version = ""
    timeout = SOCKET_TIMEOUT_SECONDS

    def log_message(self, format, *args):  # noqa: A002 - signature from the base class
        pass  # never log requests (they would leak paths and clutter the agent's output)

    def handle_one_request(self):
        """Like the standard library's, but every method (known or not) goes through _dispatch,
        and HTTP/0.9 is refused by closing the connection."""
        self._body_done = False
        watchdog = threading.Timer(REQUEST_DEADLINE_SECONDS, self._kill)
        watchdog.daemon = True
        watchdog.start()
        try:
            self.raw_requestline = self.rfile.readline(65537)
            if len(self.raw_requestline) > 65536:
                self.requestline = ""
                self.request_version = ""
                self.command = ""
                self.send_error(414)
                self.close_connection = True
                return
            if not self.raw_requestline:
                self.close_connection = True
                return
            if not self.parse_request():
                self.close_connection = True
                return
            if self.request_version not in ("HTTP/1.0", "HTTP/1.1"):
                self.close_connection = True  # HTTP/0.9 has no headers: no Host check possible
                return
            self._dispatch()
            self.wfile.flush()
        except OSError:
            self.close_connection = True
        finally:
            watchdog.cancel()

    def _kill(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _framing(self):
        """Returns ("none", 0) | ("length", n) | ("chunked", None). Raises BadFraming on anything ambiguous."""
        te = self.headers.get_all("Transfer-Encoding") or []
        cl = self.headers.get_all("Content-Length") or []
        if te:
            if len(te) != 1 or te[0].strip().lower() != "chunked" or cl:
                raise BadFraming()
            return "chunked", None
        if cl:
            if len(cl) != 1 or not _DIGITS.match(cl[0].strip()):
                raise BadFraming()
            n = int(cl[0].strip())
            return ("length", n) if n > 0 else ("none", 0)
        return "none", 0

    def _has_body(self):
        try:
            return self._framing()[0] != "none"
        except BadFraming:
            return True

    def _send(self, status, body_bytes, headers):
        # A request whose body we did not read is answered, then the connection is closed.
        drop = self._has_body() and not self._body_done
        self.send_response(status)
        for k, v in BASE_HEADERS:
            self.send_header(k, v)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body_bytes)))
        if drop:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body_bytes)
        self.wfile.flush()
        if drop:
            self._linger()

    def _json(self, status, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = [("Content-Type", "application/json; charset=utf-8")]
        if extra:
            headers.extend(extra)
        self._send(status, body, headers)

    def _linger(self):
        try:
            self.connection.shutdown(socket.SHUT_WR)
            self.connection.settimeout(0.2)
            deadline = time.monotonic() + LINGER_SECONDS
            total = 0
            while time.monotonic() < deadline and total < LINGER_MAX_BYTES:
                try:
                    data = self.connection.recv(65536)
                except socket.timeout:
                    continue
                if not data:
                    break
                total += len(data)
        except OSError:
            pass

    def _dispatch(self):
        try:
            if S.finished or S.closing:
                return self._json(503, {"error": "closing"})
            try:
                self._framing()
            except BadFraming:
                return self._json(400, {"error": "invalid request body framing"})
            hosts = self.headers.get_all("Host") or []
            # Foreign hosts are refused. Only legitimate requests reset the idle timer.
            if len(hosts) != 1 or hosts[0] != S.expected_host:
                return self._json(403, {"error": "unexpected host"})
            path = self.path.split("?", 1)[0].split("#", 1)[0]
            if path == "/api/export":
                return self._export()
            return self._static(path)
        except OSError:
            self.close_connection = True
        except Exception as e:  # unexpected bug on one request: answer it, keep serving others
            self.close_connection = True
            try:
                self._json(500, {"error": "internal error: " + type(e).__name__})
            except Exception:
                pass

    # ----- export -----

    def _export(self):
        if self.command != "POST":
            return self._json(405, {"error": "method not allowed"}, [("Allow", "POST")])

        origins = self.headers.get_all("Origin")
        if origins is not None and (len(origins) != 1 or origins[0] != S.origin):
            return self._json(403, {"error": "foreign origin"})
        touch()

        if S.token_used or not token_matches(self.headers.get_all("X-Hawiya-Token")):
            return self._refuse_token()

        media = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media != "application/json":
            return self._json(415, {"error": "content type must be application/json"})

        raw = self._read_body()
        if raw is None:
            return  # already answered (413 / 400)

        try:
            payload = strict_json_loads(raw.decode("utf-8", "replace"))
        except (ValueError, RecursionError):
            return self._json(400, {"error": "body is not valid JSON"})
        problem = validate_export(payload)
        if problem:
            return self._json(400, {"error": problem})

        refuse = False
        with S.write_lock:
            if S.finished or S.closing:
                self.close_connection = True
                return  # the server already decided to close while the body was arriving: write nothing
            if S.token_used:
                refuse = True
            else:
                status, result = write_export(payload["files"])
                if status is not None:
                    return self._json(status, result)
                S.token_used = True
        if refuse:
            return self._refuse_token()

        # The files are on disk: from here the server closes no matter how the client behaves.
        try:
            self._json(200, {"written": result})
        finally:
            finish(0, {"written": result})

    def _refuse_token(self):
        with S.lock:
            S.failed_attempts += 1
            too_many = S.failed_attempts >= MAX_FAILED_ATTEMPTS
            if too_many:
                S.closing = True  # refuse everything else from now on, even before this reply is sent
        try:
            self._json(401, {"error": "invalid token"})
        finally:
            if too_many:
                finish(1, {"reason": "too many failed attempts"})

    def _read_body(self):
        """Read the request body within MAX_BODY_BYTES. Returns bytes, or None after answering an error."""
        kind, length = self._framing()
        if kind == "chunked":
            chunks = []
            total = 0
            while True:
                line = self.rfile.readline(1024)
                m = _CHUNK_SIZE.match(line)
                if not m:
                    self._json(400, {"error": "malformed chunked body"})
                    return None
                size = int(m.group(1), 16)
                if size == 0:
                    while True:  # optional trailers, ended by an empty line
                        trailer = self.rfile.readline(1024)
                        if trailer == b"\r\n":
                            break
                        if not trailer.endswith(b"\r\n"):
                            self._json(400, {"error": "malformed chunked body"})
                            return None
                    break
                total += size
                if total > MAX_BODY_BYTES:
                    self._json(413, {"error": "body too large"})
                    return None
                data = self.rfile.read(size)
                if len(data) != size:
                    raise ConnectionError("body ended early")
                chunks.append(data)
                if self.rfile.readline(4) != b"\r\n":
                    self._json(400, {"error": "malformed chunked body"})
                    return None
            self._body_done = True
            return b"".join(chunks)

        if length > MAX_BODY_BYTES:
            self._json(413, {"error": "body too large"})
            return None
        data = self.rfile.read(length) if length else b""
        if len(data) != length:
            raise ConnectionError("body ended early")
        self._body_done = True
        return data

    # ----- static picker files -----

    def _static(self, path):
        if self.command not in ("GET", "HEAD"):
            return self._json(405, {"error": "method not allowed"}, [("Allow", "GET, HEAD")])
        # Browsers mark requests made by other sites; those do not count as activity.
        if self.headers.get("Sec-Fetch-Site") not in ("cross-site", "same-site"):
            touch()

        def not_found():
            return self._json(404, {"error": "not found"})

        try:
            decoded = unquote(path, errors="strict")
        except UnicodeDecodeError:
            return not_found()
        if "\0" in decoded or "\\" in decoded:
            return not_found()
        if any(seg in ("..", ".") for seg in decoded.split("/")):
            return not_found()

        root = S.picker_root
        target = os.path.abspath(os.path.join(root, "." + decoded))
        if target != root and not target.startswith(root + os.sep):
            return not_found()
        try:
            real = os.path.realpath(target)
            if os.path.isdir(real):
                real = os.path.realpath(os.path.join(real, "index.html"))
            if not real.startswith(root + os.sep) or not os.path.isfile(real):
                return not_found()
            with open(real, "rb") as fh:  # picker files are small
                content = fh.read()
        except (OSError, ValueError):
            return not_found()

        ctype = CONTENT_TYPES.get(os.path.splitext(real)[1].lower(), "application/octet-stream")
        self._send(200, content, [("Content-Type", ctype)])


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup of the bind address (can be slow); we know the name.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def handle_error(self, request, client_address):
        # One broken connection (client gone, or an unexpected bug on malformed input) only closes
        # that connection; it must never let an unauthenticated client stop the server.
        return


def _fatal_hook(exc_type, exc, tb):
    if not S.finished:
        S.finished = True
        print_line({"status": "closed", "reason": "internal error: " + exc_type.__name__})
    os._exit(1)


def main():
    project, idle_seconds = parse_args(sys.argv[1:])
    S.project = project
    S.design_dir = os.path.join(project, "design")
    S.picker_root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "picker"))
    S.idle_seconds = idle_seconds

    token = secrets.token_urlsafe(32)
    S.token_digest = hashlib.sha256(token.encode("ascii")).digest()

    sys.excepthook = _fatal_hook
    threading.excepthook = lambda args: _fatal_hook(args.exc_type, args.exc_value, args.exc_traceback)

    server = Server(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    S.expected_host = "127.0.0.1:%d" % port
    S.origin = "http://" + S.expected_host
    touch()
    print_line({"status": "ready", "url": S.origin + "/#token=" + token, "existing": existing_design_files()})
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        os._exit(130)


if __name__ == "__main__":
    main()
