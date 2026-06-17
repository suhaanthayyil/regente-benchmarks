"""Shared command dispatcher. EVERY contributor edits THIS one file.

Two kinds of shared region live here:

1. ADDITIVE (commutative): the HANDLERS list and the chain of `elif cmd == ...`
   branches in route(). Independent contributors each ADD one entry; order does not
   matter and nothing they add conflicts. Keep every existing entry and branch.

2. SHARED-LOGIC (ordered): the ONE function _validate(a, b). MULTIPLE contributors
   must each add a guard check to its body. These edits target the SAME function, so
   they genuinely overlap: whoever writes second must keep the check the first added.
"""

HANDLERS = ["noop"]


def _validate(a, b):
    # Contributors add guard checks here. Every check that was here before yours must
    # remain. Return False to reject the arguments.
    return True


def route(cmd, a, b):
    if not _validate(a, b):
        raise ValueError("invalid args")
    if cmd == "noop":
        return 0
    raise ValueError("unknown command: " + cmd)
