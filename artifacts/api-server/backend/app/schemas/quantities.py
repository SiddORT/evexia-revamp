"""Canonical business quantities, independent of clinical and money contracts.

Source parsing is bounded and checks the original value before rounding. Do not
use this parser to authenticate historical ledger evidence: that must stay exact.
"""
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext

SOURCE_PATTERN = r"^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$"
MAXIMUM = Decimal("1000000")
HUNDREDTH = Decimal("0.01")


def source_quantity(value, *, maximum=MAXIMUM, whole=False):
    if not isinstance(value, str) or len(value) > 14 or not re.fullmatch(SOURCE_PATTERN, value):
        raise ValueError("Use a plain quantity with up to six source fractional digits.")
    amount = Decimal(value)
    if amount > maximum:
        raise ValueError(f"Quantity cannot exceed {maximum}.")
    if whole and amount != amount.to_integral_value():
        raise ValueError("This quantity must be a whole number before rounding.")
    return amount


def rounded_quantity(value):
    """Arithmetic boundary, not input validation; signed residuals are supported."""
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("Use an exact decimal, not binary floating point.")
    with localcontext() as context:
        context.prec = 80
        amount = Decimal(value)
        if not amount.is_finite():
            raise ValueError("Quantity must be finite.")
        result = amount.quantize(HUNDREDTH, rounding=ROUND_HALF_UP)
        return abs(result) if not result else result


def quantity_string(value, *, positive=False, whole=False, maximum=MAXIMUM):
    original = source_quantity(value, maximum=maximum, whole=whole)
    rounded = rounded_quantity(original)
    if rounded > maximum:
        raise ValueError("Rounded quantity exceeds its supported maximum.")
    if original > 0 and rounded == 0:
        raise ValueError("A positive quantity must round to at least 0.01.")
    if positive and rounded <= 0:
        raise ValueError("Enter a positive quantity of at least 0.01 after rounding.")
    return format(rounded, ".2f")


def display_quantity(value):
    """Two-place presentation only; never authenticates or rewrites evidence."""
    return format(rounded_quantity(value), ".2f")
