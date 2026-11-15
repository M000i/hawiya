"""
Fault injection for the Python server tests (the twin of inject.js). Usage: python3 -I inject.py serve.py <args...>
Reads HAWIYA_INJECT, a JSON object:
  {"renameFail": "tokens.css", "times": 1}  os.replace/os.rename onto design/<name> raises EIO (the first `times` times)
  {"writeFail": "tokens.json"}              os.write to that file's temp file writes half, then raises EFBIG
then runs serve.py as the main program.
"""
import errno
import json
import os
import runpy
import sys

spec = json.loads(os.environ.get("HAWIYA_INJECT") or "{}")
left = [spec.get("times", float("inf"))]
_fd_paths = {}

if spec.get("renameFail"):
    def _wrap(real):
        def fake(src, dst, *a, **k):
            d = str(dst)
            if left[0] > 0 and os.path.basename(d) == spec["renameFail"] and os.path.basename(os.path.dirname(d)) == "design":
                left[0] -= 1
                raise OSError(errno.EIO, "injected EIO")
            return real(src, dst, *a, **k)
        return fake
    os.replace = _wrap(os.replace)
    os.rename = _wrap(os.rename)

if spec.get("writeFail"):
    real_open, real_write = os.open, os.write

    def fake_open(path, flags, *a, **k):
        fd = real_open(path, flags, *a, **k)
        _fd_paths[fd] = str(path)
        return fd

    def fake_write(fd, data):
        p = _fd_paths.get(fd, "")
        name = os.path.basename(p)
        if left[0] > 0 and name.startswith("." + spec["writeFail"] + ".") and name.endswith(".tmp"):
            left[0] -= 1
            real_write(fd, bytes(data)[: len(data) // 2])
            raise OSError(errno.EFBIG, "injected EFBIG")
        return real_write(fd, data)

    os.open, os.write = fake_open, fake_write

if spec.get("slowLstat"):
    # {"slowLstat": "identity.json", "ms": 800}: lstat of design/<name> takes that long (a slow disk during a save)
    import time as _time
    real_lstat = os.lstat

    def slow_lstat(p, *a, **k):
        p2 = str(p)
        if os.path.basename(p2) == spec["slowLstat"] and os.path.basename(os.path.dirname(p2)) == "design":
            _time.sleep((spec.get("ms") or 800) / 1000.0)
        return real_lstat(p, *a, **k)

    os.lstat = slow_lstat

serve = sys.argv[1]
sys.argv = [serve] + sys.argv[2:]
runpy.run_path(serve, run_name="__main__")
