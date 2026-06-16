#!/usr/bin/env python3
"""Grader for the 10-way contended dispatcher task."""
import json
import sys

EXPECTED = {
    "add": (2, 3, 5),
    "sub": (5, 3, 2),
    "mul": (2, 3, 6),
    "floordiv": (7, 2, 3),
    "mod": (7, 3, 1),
    "power": (2, 3, 8),
    "maxv": (2, 3, 3),
    "minv": (2, 3, 2),
    "absdiff": (3, 7, 4),
    "avg": (4, 6, 5),
}

try:
    from mathkit import route
except Exception as e:
    print(json.dumps({"ok": False, "error": "import failed: %s" % e, "ops_ok": 0, "expected": len(EXPECTED), "registered": []}))
    sys.exit(1)

ops_ok = 0
detail = {}
registered = []
for name, (a, b, want) in EXPECTED.items():
    try:
        got = route(name, a, b)
        if got == want:
            ops_ok += 1
            registered.append(name)
            detail[name] = "ok"
        else:
            detail[name] = "wrong(%r!=%r)" % (got, want)
    except Exception as e:
        detail[name] = "error(%s)" % e

ok = ops_ok == len(EXPECTED)
print(json.dumps({"ok": ok, "ops_ok": ops_ok, "expected": len(EXPECTED), "registered": sorted(registered), "detail": detail}))
sys.exit(0 if ok else 1)
