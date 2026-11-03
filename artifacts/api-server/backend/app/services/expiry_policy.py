"""Saved expiry dates become unusable at 00:00 Asia/Kolkata, including today."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from app.services.purchase_received_crypto import PRError


def today():
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def state(value, day=None):
    day = day or today()
    if not value:
        return "unknown"
    try:
        expiry = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise PRError("Batch expiry evidence is unreadable; stock cannot be used.", 409, "inventory_expiry_unavailable") from None
    if expiry < day:
        return "expired"
    if expiry == day:
        return "today"
    return "next15" if expiry <= day + timedelta(days=15) else "future"


def usable(meta):
    return state(meta.get("expiryDate")) in ("next15", "future")


def require_usable(meta):
    if not usable(meta):
        raise PRError("Expired, expiry-today or unknown-expiry allergen stock cannot be used. Review Expired Products; unknown historical dates are not inferred.", 409, "inventory_expired")
