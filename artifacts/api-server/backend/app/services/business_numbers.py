"""Business labels, independent of immutable relational UUIDs.

Padding is a minimum, never a truncation. Allocations are PostgreSQL sequences:
rolled-back writes can leave gaps and must never recycle issued identifiers.
"""
import re

FORMATS = {
    "immunotherapy": ("IT", 6),
    "kits": ("kit", 6),
    "spt": ("spt", 7),
    "lupin": ("lup", 6),
    "staff": ("ST", 3),
    "allergen": ("ALG", 3),
    "patient": ("PAT", 3),
    "doctor": ("DR", 3),
    "mr": ("MR", 3),
}


def format_number(kind, value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("Business sequence values must be positive integers")
    prefix, width = FORMATS[kind]
    return f"{prefix}-{value:0{width}d}"


def allergen_default(context):
    from sqlalchemy import text
    return format_number("allergen", context.connection.scalar(
        text("SELECT nextval('allergen_number_seq')")))


def suffix(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("Suborder sequence values must be positive integers")
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def suborder_number(parent, value):
    if not re.fullmatch(r"IT-[0-9]{6,}", parent):
        raise ValueError("Invalid parent Immunotherapy number")
    return parent + suffix(value)


def suborder_ordinal(value):
    legacy = re.fullmatch(r"SUB-?([0-9]{3,12})", value)
    if legacy:
        result = int(legacy[1])
        if result > 0:
            return result
    current = re.fullmatch(r"IT-[0-9]{6,}([A-Z]+)", value)
    if current:
        result = 0
        for char in current[1]:
            result = result * 26 + ord(char) - 64
        return result
    raise ValueError("Unrecognized saved suborder identity")


def align_suborders(value, parent):
    """Transform a copy of current groups, never immutable historicalGroups."""
    from copy import deepcopy
    result = deepcopy(value)
    canonical = result.get("pricingBasis") == "suborder_mrp_v1"
    issued = set()

    def align(saved):
        target = suborder_number(parent, suborder_ordinal(saved))
        if target in issued:
            raise ValueError("Conflicting saved IT suborders; explicit record review required")
        issued.add(target)
        return target

    for group in result["groups"]:
        if canonical:
            group["id"] = align(group["id"])
        for item in group["items"]:
            if item.get("suborderId"):
                item["suborderId"] = align(item["suborderId"])
    return result
