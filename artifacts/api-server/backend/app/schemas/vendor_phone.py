"""Vendor compatibility wrapper around shared maintained phone metadata."""
from app.schemas.phone import COUNTRIES as VENDOR_COUNTRIES, normalize_phone


def normalize_vendor_phone(value: str, country: str) -> str:
    return normalize_phone(value, country, "vendor")
