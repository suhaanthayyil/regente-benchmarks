"""mathkit: a tiny registry of two-argument math operations."""

from .registry import REGISTRY, register

__all__ = ["REGISTRY", "register"]

# Operations are also re-exported below (each contributor appends its import + __all__ entry).
