#!/usr/bin/env python3
"""
Harness for the Python identity checker (task 1.13), driven by tests/server/python-validate.test.js.

Reads JSON lines on stdin: {"schema": "identity" | "template" | "session", "text": "<document as JSON text>"}
Writes one JSON line per input:   {"valid": bool, "errors": [[instancePath, keyword], ...]}
The Node test compares every answer with the JavaScript checker (picker/js/core/validate.js).

    python3 -I tests/server/python_validate_test.py --self-test   runs a few direct checks and prints "ok"
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVE = os.path.join(HERE, "..", "..", "scripts", "serve.py")


def load_serve():
    spec = importlib.util.spec_from_file_location("hawiya_serve", SERVE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # serve.py only defines things on import; main() runs only as a script
    return mod


def self_test(m):
    with open(os.path.join(HERE, "..", "fixtures", "identity", "valid", "identity-ar-web-app.json"), encoding="utf-8") as f:
        text = f.read()
    assert m.check_document_text("identity", text)["valid"]
    assert not m.check_document_text("identity", text.replace('"schemaVersion": 1', '"schemaVersion": true'))["valid"], "true is not 1"
    assert not m.check_document_text("identity", text.replace('"schemaVersion": 1', '"schemaVersion": NaN'))["valid"]
    assert m.check_document_text("identity", text.replace('"schemaVersion": 1', '"schemaVersion": 1.0'))["valid"]
    try:
        m.compile_schema({"format": "email"})
        raise AssertionError("unknown keyword accepted")
    except m.SchemaError:
        pass
    print("ok")


def main():
    m = load_serve()
    if "--self-test" in sys.argv:
        return self_test(m)
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        case = json.loads(line)
        r = m.check_document_text(case["schema"], case["text"])
        out.write(json.dumps({"valid": r["valid"], "errors": [[e["instancePath"], e["keyword"]] for e in r["errors"]]}) + "\n")
    out.flush()


if __name__ == "__main__":
    main()
