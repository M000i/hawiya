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
"""

import errno
import hashlib
import hmac
import json
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
