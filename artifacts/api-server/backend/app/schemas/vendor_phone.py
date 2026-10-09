"""International metadata scoped to vendors; legacy master contracts stay unchanged."""
import re
import phonenumbers
from app.schemas.staff import COUNTRIES as LEGACY_COUNTRIES

VENDOR_COUNTRIES = tuple(sorted(phonenumbers.SUPPORTED_REGIONS))


def normalize_vendor_phone(value: str, country: str) -> str:
    if country not in VENDOR_COUNTRIES:
        raise ValueError("Select a supported phone country.")
    if country in LEGACY_COUNTRIES:
        local = re.sub(r"^\+91[\s-]?", "", value) if country == "IN" else value
        digits = re.sub(r"[\s()-]", "", local)
        if (not re.fullmatch(r"[0-9\s()-]+", local) or len(digits) != LEGACY_COUNTRIES[country]
                or (country == "IN" and not re.fullmatch(r"[6-9][0-9]{9}", digits))):
            raise ValueError("Invalid phone number for the selected country.")
        return digits
    if not re.fullmatch(r"\+?[0-9\s()-]+", value):
        raise ValueError("Invalid phone number for the selected country.")
    try:
        phone = phonenumbers.parse(value, country)
    except phonenumbers.NumberParseException:
        raise ValueError("Invalid phone number for the selected country.") from None
    if not phonenumbers.is_valid_number_for_region(phone, country):
        raise ValueError("Invalid phone number for the selected country.")
    return phonenumbers.national_significant_number(phone)
