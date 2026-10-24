"""MR-only presentation copies. Never use these projections for persistence."""

ADDRESS_FIELDS = frozenset({
    "addressLine1", "addressLine2", "line1", "line2", "landmark",
    "pincode", "postalCode", "city", "state", "country",
})
PHONE_FIELDS = frozenset({"phone", "alternatePhone"})
MASKED_ADDRESS = "Address masked"


def phone_display(value):
    digits = "".join(c for c in str(value or "") if c.isascii() and c.isdigit())
    return ("********" + digits[-2:]) if len(digits) > 2 else ("********" if digits else "")


def person(value):
    """Preserve identity/demographics and shape, including historical contacts."""
    if not isinstance(value, dict):
        return value
    result = dict(value)
    for key, child in value.items():
        if key in PHONE_FIELDS:
            result[key] = phone_display(child)
        elif key == "email":
            result[key] = "***@***" if child else ""
        elif key in ADDRESS_FIELDS:
            result[key] = MASKED_ADDRESS if child else ""
        elif key == "address":
            result[key] = (
                {field: MASKED_ADDRESS if content else "" for field, content in child.items()}
                if isinstance(child, dict) else MASKED_ADDRESS if child else ""
            )
    return result


def order_result(actor, value):
    """Project all response envelopes, not internal resolution/retry snapshots.

    MR self contacts and manually entered Other shipping are not person-master
    contacts. Recipient provenance comes from the saved shipping choice.
    """
    if actor.role != "mr":
        return value
    if isinstance(value, list):
        return [order_result(actor, child) for child in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, child in value.items():
        if key in {"doctor", "patient", "billing"}:
            result[key] = person(child)
        elif key == "patients" and isinstance(child, list):
            result[key] = [person(item) for item in child]
        elif key == "recipient" and value.get("shipping") in {"doctor", "patient"}:
            result[key] = person(child)
        else:
            result[key] = order_result(actor, child)
    return result
