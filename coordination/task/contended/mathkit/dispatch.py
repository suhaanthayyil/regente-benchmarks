"""Shared command dispatcher.

EVERY contributor edits THIS one file. There are two shared regions you must both
touch: the HANDLERS list and the route() function. Keep all existing entries and
branches intact and add yours alongside them.
"""

HANDLERS = ["noop"]


def route(cmd, a, b):
    if cmd == "noop":
        return 0
    raise ValueError("unknown command: " + cmd)
