"""Exact, bounded rate normalization. Never use binary floats for rates."""
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext

PLAIN_DECIMAL = re.compile(r"^[0-9]+(?:\.[0-9]{1,6})?$")
MAX_PRICE = Decimal("999999999999.99")


def source_decimal(value):
    if not isinstance(value, str) or len(value) > 64 or not PLAIN_DECIMAL.fullmatch(value.strip()):
        raise ValueError("Use a non-negative plain decimal string with at most six fractional digits")
    text = value.strip()
    if len(text.split(".")[0].lstrip("0")) > 12:
        raise ValueError("At most twelve integer digits")
    return Decimal(text)


def rate(value, maximum=MAX_PRICE):
    amount = source_decimal(value)
    # Check the ORIGINAL percentage, not a rounded-down invalid percentage.
    if maximum == Decimal("100") and amount > maximum:
        raise ValueError("Percentage must be between zero and 100")
    with localcontext() as context:
        context.prec = 80
        rounded = amount.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
    if rounded > maximum:
        raise ValueError("Rounded rate exceeds its supported maximum")
    return format(rounded, ".2f")


def display_rate(value):
    """Presentation only, including retained snapshots; never fed into arithmetic."""
    with localcontext() as context:
        context.prec = 80
        return format(Decimal(value).quantize(Decimal(".01"), rounding=ROUND_HALF_UP), ".2f")
