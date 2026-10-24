"""MR-only presentation copies. Never use these projections for persistence."""

from email_validator import EmailNotValidError, validate_email

PHONE_FIELDS = frozenset({"phone", "alternatePhone"})


def phone_display(value):
    digits = "".join(c for c in str(value or "") if c.isascii() and c.isdigit())
    return ("********" + digits[-2:]) if len(digits) > 2 else ("********" if digits else "")


def email_display(value):
    """Expose only a valid saved domain; never guess one from malformed input."""
    if not value:
        return ""
    if not isinstance(value, str):
        return "***"
    email = value.strip()
    if not email:
        return ""
    try:
        validate_email(email, check_deliverability=False)
    except EmailNotValidError:
        return "***"
    # Validation guards against extra @ signs, display names and trailing text.
    # Keep the saved spelling rather than the validator's normalized domain.
    return "***@" + email.rsplit("@", 1)[1]


def person(value):
    """Mask phones/email locals, preserving saved addresses and other facts."""
    if not isinstance(value, dict):
        return value
    result = dict(value)
    for key, child in value.items():
        if key in PHONE_FIELDS:
            result[key] = phone_display(child)
        elif key == "email":
            result[key] = email_display(child)
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
