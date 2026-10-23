"""Account labels only: never add these numbers to staff login aliases."""
from sqlalchemy import func, select, text

from app.db.staff_models import StaffProfile
from app.services.account_crypto import AccountCryptoError, ready

ADMIN_NUMBER = "EVX-001"


def assert_available(db, value, owner=None):
    current = ready(db)
    db.execute(text("SELECT pg_advisory_xact_lock(73182451)"))
    digest = current.lookup_index(value.lower())
    reserved = db.scalar(text(
        "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"
    ), {"digest": digest})
    # Also retain unresolved/deleted Employee Codes not staged as login aliases.
    code_owner = db.scalar(select(StaffProfile.user_id).where(
        func.lower(StaffProfile.employee_code) == value.lower(),
        *([StaffProfile.user_id != owner] if owner is not None else []),
    ).limit(1))
    if (reserved is not None and reserved != owner) or code_owner is not None:
        raise AccountCryptoError(
            "EVX account number conflicts with a retained identifier; operator review is required.")
    return value


def allocate(db):
    # PostgreSQL nextval is durable, concurrent-safe and never rolled back.
    # Do not retry collisions: an unexpected namespace owner needs review.
    ready(db)
    db.execute(text("SELECT pg_advisory_xact_lock(73182451)"))
    number = db.scalar(text("SELECT nextval('staff_account_number_seq')"))
    return assert_available(db, f"EVX-{number:03d}")
