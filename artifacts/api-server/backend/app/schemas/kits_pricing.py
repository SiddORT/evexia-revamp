"""Optional encrypted Kits pricing; decimal strings, never binary floats."""
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from pydantic import Field, field_validator
from app.schemas.immunotherapy import Strict

CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("999999999.99")
MAX_TOTAL = Decimal("999999999999999999.99")


def amount(value: str, maximum=MAX_AMOUNT) -> str:
    # Check the original value before rounding (notably 100.001 percent).
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,18}(?:\.\d{1,6})?", value):
        raise ValueError("Use a nonnegative plain decimal with at most six fractional digits")
    raw = Decimal(value)
    rounded = raw.quantize(CENT, rounding=ROUND_HALF_UP)
    if raw > maximum or rounded > maximum:
        raise ValueError("Amount is out of range")
    return format(rounded, ".2f")


class KitsPricingInput(Strict):
    kitRate: str | None = Field(default=None, max_length=32)
    lancetsRate: str | None = Field(default=None, max_length=32)
    applicatorsRate: str | None = Field(default=None, max_length=32)
    trayRate: str | None = Field(default=None, max_length=32)
    forwardingCharges: str = Field(max_length=32)
    discountType: Literal["percent", "inr"]
    discountValue: str = Field(max_length=32)

    @field_validator("kitRate", "lancetsRate", "applicatorsRate", "trayRate")
    @classmethod
    def rate(cls, value):
        return None if value is None else amount(value)

    @field_validator("forwardingCharges")
    @classmethod
    def forwarding(cls, value):
        return amount(value)

    @field_validator("discountValue")
    @classmethod
    def discount(cls, value, info):
        amount(value, Decimal("100") if info.data.get("discountType") == "percent" else MAX_AMOUNT)
        # Retain the raw fixed value until comparison with gross.
        return value


class KitsPricingSnapshot(KitsPricingInput):
    taxPercentage: str
    lineAmounts: dict[str, str]
    gross: str
    discountAmount: str
    discounted: str
    taxable: str
    gst: str
    total: str


def calculate(body, pricing, tax_percentage="5.00"):
    values = pricing.model_dump()
    lines = {}
    for key in ("kit", "lancets", "applicators", "tray"):
        count = body.kit.quantity if key == "kit" else getattr(body, key)
        if not count:
            continue
        rate = values[f"{key}Rate"]
        if rate is None:
            raise ValueError(f"Enter the {key} unit rate; zero is allowed")
        lines[key] = format(Decimal(count) * Decimal(rate), ".2f")
    gross = sum((Decimal(v) for v in lines.values()), Decimal(values["forwardingCharges"]))
    raw_discount = Decimal(values["discountValue"])
    values["discountValue"] = amount(values["discountValue"],
        Decimal("100") if values["discountType"] == "percent" else MAX_AMOUNT)
    discount = Decimal(values["discountValue"])
    if values["discountType"] == "inr" and raw_discount > gross:
        raise ValueError("Fixed discount cannot exceed gross")
    if values["discountType"] == "percent":
        discount = (gross * discount / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    if discount > gross:
        raise ValueError("Fixed discount cannot exceed gross")
    taxable = gross - discount
    gst = (taxable * Decimal(tax_percentage) / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    total = taxable + gst
    if total > MAX_TOTAL:
        raise ValueError("Total is out of range")
    return dict(**values, taxPercentage=tax_percentage, lineAmounts=lines,
        gross=format(gross, ".2f"), discountAmount=format(discount, ".2f"),
        discounted=format(taxable, ".2f"), taxable=format(taxable, ".2f"),
        gst=format(gst, ".2f"), total=format(total, ".2f"))
