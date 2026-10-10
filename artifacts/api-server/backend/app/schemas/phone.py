"""Shared maintained calling regions with explicit historical master policies."""
import re
import phonenumbers
from typing import Literal

COUNTRIES = tuple(sorted(phonenumbers.SUPPORTED_REGIONS))
DialCountry = Literal[*COUNTRIES]
DIAL = {region: f"+{phonenumbers.country_code_for_region(region)}" for region in COUNTRIES}
LEGACY_DIGITS = {"IN": 10, "US": 10, "GB": 10, "AE": 9}


def normalize_phone(value: str, country: str, master: str = "doctor") -> str:
    if country not in COUNTRIES:
        raise ValueError("Select a supported phone country.")
    raw = value.strip()
    local = re.sub(r"^\+91[\s-]?", "", raw) if country == "IN" and master in ("mr", "staff", "vendor") else raw
    digits = re.sub(r"[\s()-]", "", local)
    legacy = (10 if country == "IN" else None) if master == "mr" else LEGACY_DIGITS.get(country)
    if legacy:
        if (not re.fullmatch(r"[0-9\s()-]+", local) or len(digits) != legacy
                or (master in ("staff", "vendor") and country == "IN" and not re.fullmatch(r"[6-9][0-9]{9}", digits))):
            raise ValueError("Invalid phone number for the selected country.")
        return digits
    if not re.fullmatch(r"\+?[0-9\s()-]+", raw):
        raise ValueError("Invalid phone number for the selected country.")
    try:
        phone = phonenumbers.parse(raw, country)
    except phonenumbers.NumberParseException:
        raise ValueError("Invalid phone number for the selected country.") from None
    if not phonenumbers.is_valid_number_for_region(phone, country):
        raise ValueError("Invalid phone number for the selected country.")
    return phonenumbers.national_significant_number(phone)
