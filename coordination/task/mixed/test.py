#!/usr/bin/env python3
"""Grader for the MIXED dispatcher task.

Correct only if BOTH shared regions integrated:
  - ADDITIVE: every command routes to the right result (no dropped HANDLERS entry or
    route() branch).
  - SHARED-LOGIC: both guard checks survive in _validate. The two guards are independent
    (a non-negative check and a magnitude check) so each is detectable on its own: if one
    contributor clobbered the other's edit to _validate, exactly one guard survives and
    this fails. That lost guard is the work the conflict path must prevent.

The two guards never reject any of the EXPECTED command inputs (all small, non-negative),
so a correct merge passes every command AND both guard probes.
"""
import json
import sys

EXPECTED = {
    "add": (2, 3, 5),
    "sub": (5, 3, 2),
    "mul": (2, 3, 6),
    "floordiv": (7, 2, 3),
    "mod": (7, 3, 1),
    "power": (2, 3, 8),
}

try:
    from mathkit import route
except Exception as e:  # noqa: BLE001
    print(json.dumps({"ok": False, "error": "import failed: %s" % e, "ops_ok": 0, "expected": len(EXPECTED), "validate_nonneg_ok": False, "validate_range_ok": False}))
    sys.exit(1)

ops_ok = 0
detail = {}
for name, (a, b, want) in EXPECTED.items():
    try:
        got = route(name, a, b)
        if got == want:
            ops_ok += 1
            detail[name] = "ok"
        else:
            detail[name] = "wrong(%r!=%r)" % (got, want)
    except Exception as e:  # noqa: BLE001
        detail[name] = "error(%s)" % e


def _rejects(a, b):
    try:
        route("add", a, b)
        return False
    except Exception:  # noqa: BLE001
        return True


# Each guard is probed with an input that ONLY that guard rejects (the other guard passes
# it), so the two are independently detectable.
validate_nonneg_ok = _rejects(-1, 3)   # negative rejected -> non-negative guard present
validate_range_ok = _rejects(2000, 3)  # > 1000 rejected   -> magnitude guard present

ok = ops_ok == len(EXPECTED) and validate_nonneg_ok and validate_range_ok
print(json.dumps({
    "ok": ok,
    "ops_ok": ops_ok,
    "expected": len(EXPECTED),
    "validate_nonneg_ok": validate_nonneg_ok,
    "validate_range_ok": validate_range_ok,
    "detail": detail,
}))
sys.exit(0 if ok else 1)
