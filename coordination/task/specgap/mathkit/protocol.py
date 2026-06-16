"""The record protocol.

The PRODUCER agent fills this in by choosing FIELDS. CONSUMER agents must build records
using the EXACT field names and order the producer chose. The producer's choice is NOT
specified anywhere else, so consumers can only get it right by coordinating to learn it.
This is the "specification gap": correctness depends on a decision only one agent holds.
"""

FIELDS = []  # producer: set to a list of EXACTLY three field-name strings (your choice)


def make_record(*values):
    """Producer: return a dict mapping FIELDS to the given values, in order."""
    raise NotImplementedError
