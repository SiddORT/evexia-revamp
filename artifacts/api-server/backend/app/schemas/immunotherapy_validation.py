"""Value-free, allowlisted validation locations for protected order requests."""
import re


_TOP = {
    "orderDate", "patientId", "doctorId", "mrId", "dosage", "histamine",
    "saline", "remarks", "shipping", "status", "idempotencyKey",
    "expected_version", "reviewToken", "confirmUpdates", "poNumber", "pricingBasis",
}
_CODES = {
    "missing", "uuid_parsing", "uuid_type", "string_type", "string_too_short",
    "string_too_long", "string_pattern_mismatch", "literal_error", "too_short",
    "too_long", "list_type", "model_type", "value_error", "extra_forbidden",
    "int_type", "greater_than_equal", "date_from_datetime_parsing",
    "date_parsing", "date_type", "json_invalid", "bool_parsing", "bool_type",
}
_NESTED = re.compile(
    r"(?:groups(?:\.\d{1,3}(?:\.(?:id|mrp|items(?:\.\d{1,3}(?:\.(?:allergenId|result|rate|suborderId))?)?))?)?"
    r"|attachmentIds(?:\.\d{1,2})?)"
)


def order_field_errors(errors):
    result = []
    for error in errors[:20]:
        parts = list(error.get("loc", ()))
        scope = parts.pop(0) if parts else "body"
        path = ".".join(str(part) for part in parts if isinstance(part, (str, int)))
        prefix = ""
        if path.startswith("entries."):
            match = re.fullmatch(r"entries\.(\d{1,3})\.(id|expected_version|values(?:\.(.*))?)", path)
            if match:
                prefix = f"entries.{match[1]}."
                path = match[2]
                if path.startswith("values."):
                    prefix += "values."
                    path = match[3]
            else:
                path = ""
        allowed = scope == "body" and (
            path in _TOP or path in {"entries", "id", "values"} or _NESTED.fullmatch(path)
        )
        result.append({
            "field": f"body.{prefix}{path}" if allowed else "body",
            "code": error["type"] if error.get("type") in _CODES else "invalid_value",
        })
    return result
