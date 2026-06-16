"""Operation registry for mathkit.

Every operation registers itself here. Multiple contributors edit this one file,
so it is the shared file that coordination has to protect from clobbering.
"""

REGISTRY = {}


def register(name, fn):
    """Register a two-argument operation under a name."""
    REGISTRY[name] = fn


# Each operation registers itself below this line. Add, do not remove others.
# Example:  from .op_add import add ; register("add", add)
