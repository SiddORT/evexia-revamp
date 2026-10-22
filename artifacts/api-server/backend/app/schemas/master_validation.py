"""Semantic checks for explicit master writes, never for historical reads.

Keep this deliberately separate from identifiers, addresses, free text, numeric
contracts and database comparison keys. No Unicode normalization/case conversion
is performed here: each directory keeps its established uniqueness contract.
"""
import re
import unicodedata
from typing import ClassVar

from pydantic import BaseModel, field_validator


NAME_SPACE = re.compile(r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")


def name_text(value):
    return NAME_SPACE.sub(" ", value).strip(" ")


def meaningful_name(value, label, personal=False):
    # ZWJ/ZWNJ are meaningful in international scripts. Other invisible format
    # controls, unpaired surrogates and noncharacters are not name content.
    if any((unicodedata.category(c).startswith("C") and c not in "\u200c\u200d"
            and not NAME_SPACE.fullmatch(c))
           or c in "\ufffe\uffff" for c in value):
        raise ValueError(f"{label} contains unsupported control characters.")
    value = name_text(value)
    categories = ("L",) if personal else ("L", "N")
    if not any(unicodedata.category(c).startswith(categories) for c in value):
        content = "a letter" if personal else "letters or numbers"
        raise ValueError(f"Enter a valid {label} containing {content}. Symbols alone are not allowed.")
    return value


class MasterWriteFields(BaseModel):
    master_names: ClassVar[dict[str, tuple[str, bool]]] = {}
    master_read: ClassVar[bool] = False

    @field_validator("*", mode="before")
    @classmethod
    def semantic_master_name(cls, value, info):
        spec = cls.master_names.get(info.field_name)
        if not cls.master_read and spec and isinstance(value, str):
            return meaningful_name(value, *spec)
        return value


def master_field_errors(path, errors):
    """Project only known field paths and constant guidance, never input/ctx.

    Pydantic messages can include submitted values or property names. Keep those
    out of API errors (especially MR passwords); even extra property paths are
    replaced with 'body'. Transfers have their own bounded row errors.
    """
    prefix = "/api/v1/admin/"
    resource = path[len(prefix):].split("/", 1)[0] if path.startswith(prefix) else ""
    if resource not in {
        "zones", "languages", "courier-partners", "designations", "mrs", "doctors",
        "patients", "vendors", "product-categories", "storage-locations", "headquarters",
        "products", "allergens", "sales-targets", "opening-balances", "opening-stock",
    }:
        return None
    from app.schemas.zones import ZoneFields
    from app.schemas.languages import LanguageFields
    from app.schemas.couriers import CourierFields
    from app.schemas.designations import DesignationFields
    from app.schemas.mrs import MRCreate
    from app.schemas.doctors import DoctorFields
    from app.schemas.patients import PatientFields
    from app.schemas.vendors import VendorFields
    from app.schemas.product_categories import ProductCategoryFields
    from app.schemas.locations import LocationFields
    from app.schemas.headquarters import HeadquarterCreate
    from app.schemas.products import ProductCreate
    from app.schemas.allergens import AllergenFields
    from app.schemas.sales_targets import SalesTargetFields
    from app.schemas.opening_balances import OpeningBalanceFields
    from app.schemas.opening_stock import OpeningCreate

    schemas = {
        "zones": ZoneFields, "languages": LanguageFields, "courier-partners": CourierFields,
        "designations": DesignationFields, "mrs": MRCreate, "doctors": DoctorFields,
        "patients": PatientFields, "vendors": VendorFields, "product-categories": ProductCategoryFields,
        "storage-locations": LocationFields, "headquarters": HeadquarterCreate,
        "products": ProductCreate, "allergens": AllergenFields, "sales-targets": SalesTargetFields,
        "opening-balances": OpeningBalanceFields, "opening-stock": OpeningCreate,
    }
    schema = schemas.get(resource)
    if schema is None:
        return None
    specs = getattr(schema, "master_names", {})
    allowed = set(schema.model_fields) | {"expected_version"}
    nested = {
        "areas": {"id", "name", "code"}, "members": {"allergenId", "quantity"},
        "rows": {"sourceId", "rowId", "itemKind", "itemId", "quantity", "unitRate", "locationId"},
    }
    guidance = {
        "status": "Select Active or Inactive.",
        "mix": "Select Mix or No Mix.",
        "gender": "Select male, female, other or prefer not to say.",
        "contactRequirement": "Select required or optional.",
        "invoiceType": "Select normal or gst; GST invoices require a GST number.",
        "gstNo": "Enter a valid 15-character GSTIN.",
        "gstNumber": "Enter a valid GST number; it is required for GST invoices.",
        "email": "Enter a valid email address.", "emailId": "Enter a valid email address.",
        "phone": "Enter a valid national phone number for the selected country.",
        "phoneNo": "Enter a valid national phone number for the selected country.",
        "alternatePhone": "Enter a valid national phone number for the selected country.",
        "dialCountry": "Select a supported phone country.",
        "pincode": "Enter a valid postal code (six digits for India).",
        "countryCode": "Select a supported ISO country; Indian State/UT and PIN must be valid when supplied.",
        "userId": "Use 3–32 characters: a lowercase letter first, then lowercase letters, digits, dot, underscore or hyphen.",
        "employeeCode": "Enter an employee code of 1–64 characters.",
        "initialPassword": "Use 12–128 characters or omit the password for server generation.",
        "unit_price": "Enter a nonnegative plain rate with up to six source decimals; saved half-up to two.",
        "selling_price": "Enter a nonnegative plain rate with up to six source decimals; saved half-up to two.",
        "mrp": "Enter a nonnegative plain rate with up to six source decimals; selling price must not exceed MRP.",
        "sellingPrice": "Enter a nonnegative plain rate with up to six source decimals, no greater than MRP.",
        "gst": "Enter a percentage from 0 to 100 with up to six source decimals.",
        "orderDiscount": "Enter a percentage from 0 to 100 with up to six source decimals.",
        "threshold_limit": "Enter a nonnegative quantity with up to six decimals.",
        "quantity": "Enter a supported plain quantity up to 1000000 with at most three decimals; finished products require whole quantities.",
        "unitRate": "Enter an independent nonnegative plain unit rate with up to six source decimals.",
        "amount": "Enter a signed plain amount within ±9999999999999.99 with at most two decimals. Negative balances are valid.",
        "paymentLimit": "Enter a nonnegative plain payment limit with at most two decimals within the supported limit.",
        "daysLimit": "Enter a nonnegative whole day limit within the supported range.",
        "doctorDaysLimit": "Enter a whole day limit from 0 to 3650.",
        "startYear": "Select a supported financial start year; the end year must immediately follow.",
        "endYear": "Select the consecutive year immediately after the financial start year.",
        "dateOfJoining": "Enter a real ISO date that is not in the future (India time).",
        "dateOfBirth": "Enter a real ISO date of birth that is not in the future (India time).",
        "recordedDate": "Enter a real recorded date in YYYY-MM-DD format.",
        "members": "Select 2–100 distinct saved allergens and positive quantities.",
        "zoneIds": "Select distinct saved zones and include the primary zone.",
        "areas": "Enter at most 200 valid areas with distinct names and codes within this headquarter.",
        "expected_version": "Reload and review the current saved version before submitting.",
    }
    for quarter in ("q1", "q2", "q3", "q4"):
        guidance[quarter] = "Enter a nonnegative plain amount with at most 12 integer and two fractional digits. Excess precision is rejected, not rounded."
    result = []
    for error in errors[:20]:
        loc = tuple(error["loc"])
        parts = loc[1:] if loc and loc[0] == "body" else ()
        key = parts[0] if parts else None
        safe = key in allowed
        if len(parts) > 1:
            safe = (safe and key in nested and len(parts) == 3
                    and isinstance(parts[1], int) and parts[2] in nested[key])
        field = "body." + ".".join(map(str, parts)) if safe else "body"
        leaf = parts[-1] if safe else None
        spec = specs.get(key) if safe and len(parts) == 1 else None
        if safe and key == "areas" and leaf == "name":
            spec = ("area name", False)
        if spec and error["type"] == "value_error":
            label, personal = spec
            message = f"Enter a valid {label} containing {'a letter' if personal else 'letters or numbers'}. Symbols alone are not allowed."
        elif error["type"] == "string_too_long":
            # Limits are schema-owned integers, never submitted context strings.
            limit = error.get("ctx", {}).get("max_length")
            message = f"Use at most {limit} characters." if isinstance(limit, int) else "This field is too long."
        elif error["type"] in ("missing", "string_too_short"):
            message = "This field is required and must not be blank."
        elif error["type"] == "extra_forbidden":
            message = "Remove unsupported fields from the request."
        else:
            message = guidance.get(leaf, "Check this field's required value, supported format and length.")
            if not safe:
                message = {
                    "mrs": "Check required phone/email, distinct assigned zones and primary zone selection.",
                    "doctors": "Check conditional phone/email, postal address and invoice/GST requirements.",
                    "patients": "Check the supported phone country and postal address.",
                    "sales-targets": "Financial end year must immediately follow start year.",
                    "opening-balances": "Financial end year must immediately follow start year.",
                    "products": "Choose distinct allergens; selling price must not exceed MRP.",
                    "storage-locations": "Select a supported country for structured geography; verify supplied Indian PIN and State/UT.",
                    "opening-stock": "Check distinct source/row identities, positive manual quantities and whole finished-product quantities.",
                }.get(resource, "Check the required master fields, supported formats and limits.")
        result.append({"field": field, "code": error["type"], "message": message})
    return result
