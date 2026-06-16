#!/usr/bin/env python3
"""Grader for the specification-gap task.

Passes only if the producer chose 3 fields AND every consumer's record uses EXACTLY those
field names in the same order. A consumer that invented its own field names (because it
could not learn the producer's choice) shows up as a mismatch — the specification gap.
"""
import json
import sys

CONSUMERS = ["alpha", "beta", "gamma"]

try:
    from mathkit.protocol import FIELDS
except Exception as e:
    print(json.dumps({"ok": False, "error": "protocol import failed: %s" % e, "ops_ok": 0, "expected": len(CONSUMERS)}))
    sys.exit(1)

fields_ok = isinstance(FIELDS, list) and len(FIELDS) == 3 and all(isinstance(f, str) for f in FIELDS)
detail = {}
ok_count = 0
for name in CONSUMERS:
    try:
        mod = __import__("mathkit.consumer_%s" % name, fromlist=["record_%s" % name])
        rec = getattr(mod, "record_%s" % name)()
        keys = list(rec.keys())
        if fields_ok and keys == list(FIELDS):
            ok_count += 1
            detail[name] = "ok"
        else:
            detail[name] = "mismatch(keys=%r vs FIELDS=%r)" % (keys, list(FIELDS))
    except Exception as e:
        detail[name] = "error(%s)" % e

ok = fields_ok and ok_count == len(CONSUMERS)
print(json.dumps({"ok": ok, "ops_ok": ok_count, "expected": len(CONSUMERS), "fields": list(FIELDS) if fields_ok else FIELDS, "detail": detail}))
sys.exit(0 if ok else 1)
