#!/usr/bin/env python3
"""Grader for the controlled coordination task.

Prints one JSON line and exits 0 only if every expected operation is registered
and computes the right answer. Missing registrations (the signature of a clobbered
shared file) make it fail and show exactly which operations were lost.
"""
import json
import sys

EXPECTED = {"add": (2, 3, 5), "multiply": (2, 3, 6), "subtract": (5, 3, 2)}

try:
    from mathkit.registry import REGISTRY
except Exception as e:  # import error = the package was left broken
    print(json.dumps({"ok": False, "error": "import failed: %s" % e, "ops_ok": 0, "expected": len(EXPECTED), "registered": []}))
    sys.exit(1)

registered = sorted(str(k) for k in REGISTRY.keys())
ops_ok = 0
detail = {}
for name, (a, b, want) in EXPECTED.items():
    fn = REGISTRY.get(name)
    if fn is None:
        detail[name] = "missing"
        continue
    try:
        got = fn(a, b)
        if got == want:
            ops_ok += 1
            detail[name] = "ok"
        else:
            detail[name] = "wrong(%r!=%r)" % (got, want)
    except Exception as e:
        detail[name] = "error(%s)" % e

ok = ops_ok == len(EXPECTED)
print(json.dumps({"ok": ok, "ops_ok": ops_ok, "expected": len(EXPECTED), "registered": registered, "detail": detail}))
sys.exit(0 if ok else 1)
