"""Allocate Employee Codes without changing EVX account labels."""
from sqlalchemy import func, select, text
from app.db.staff_models import StaffProfile
from app.services.account_crypto import ready
from app.services.business_numbers import format_number


def allocate(db):
    keys = ready(db)
    # Same namespace lock as all encrypted account/alias reservation writers.
    db.execute(text("SELECT pg_advisory_xact_lock(73182451)"))
    while True:
        value = db.scalar(text("SELECT nextval('staff_employee_number_seq')"))
        code = format_number("staff", value)
        reserved = db.scalar(text(
            "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"),
            {"digest": keys.lookup_index(code.lower())})
        saved = db.scalar(select(StaffProfile.id).where(
            func.lower(StaffProfile.employee_code) == code.lower()).limit(1))
        if reserved is None and saved is None:
            return code
