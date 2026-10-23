"""Staff aliases share the account reservation namespace, never plaintext history."""
from sqlalchemy import text, select, func
from app.services.account_crypto import ready
from app.services.staff_crypto import StaffError
from app.db.staff_models import StaffProfile


def save_identifiers(db, profile, email, employee_code, staff_crypto):
    current = ready(db)
    # All account writers use this same transaction lock in the namespace trigger.
    db.execute(text("SELECT pg_advisory_xact_lock(73182451)"))
    # Include unresolved/deleted legacy codes; don't let a clean new save take
    # ownership of an identifier that an administrator still needs to correct.
    for field, value in (("email", email), ("employeeCode", employee_code)):
        if db.scalar(select(StaffProfile.id).where(
                (func.lower(StaffProfile.employee_code) == value.lower()) |
                (StaffProfile.email_index == staff_crypto.email_index(value)),
                StaffProfile.id != profile.id).limit(1)):
            raise StaffError(
                f"{'Email ID' if field == 'email' else 'Employee Code'} is already saved on another staff record, including retained history.",
                409, "staff_email_duplicate" if field == "email" else "staff_employee_code_duplicate")
        if db.scalar(select(func.lower(value))) != value.lower():
            raise StaffError("Use an identifier with supported case normalization.", 422,
                             "staff_email_invalid" if field == "email" else "staff_employee_code_invalid")
        digest = current.lookup_index(value.lower())
        if digest == current.lookup_index("crm-admin@allergyevexia.in"):
            raise StaffError("This identifier is reserved for the protected administrator.", 409,
                             "staff_email_duplicate" if field == "email" else "staff_employee_code_duplicate")
        owner = db.scalar(text(
            "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"
        ), {"digest": digest})
        if owner is not None and owner != profile.user_id:
            raise StaffError(
                f"{'Email ID' if field == 'email' else 'Employee Code'} is already used or reserved by another account.",
                409, "staff_email_duplicate" if field == "email" else "staff_employee_code_duplicate")
        # Reservation field describes the encryption envelope, not the alias kind.
        # The established email envelope accepts both values (up to 320 chars).
        ciphertext = current.encrypt(profile.user_id, "email", value)
        db.execute(text("""
            INSERT INTO account_identifier_reservations(identifier_index,identifier,user_id,field)
            VALUES (:digest,:ciphertext,:owner,'email') ON CONFLICT DO NOTHING
        """), {"digest": digest, "ciphertext": ciphertext, "owner": profile.user_id})
    db.execute(text("DELETE FROM staff_login_identifiers WHERE user_id=:owner"),
               {"owner": profile.user_id})
    for value in (email, employee_code):
        db.execute(text("""
            INSERT INTO staff_login_identifiers(identifier_index,user_id)
            VALUES (:digest,:owner) ON CONFLICT DO NOTHING
        """), {"digest": current.lookup_index(value.lower()), "owner": profile.user_id})
    profile.login_identifiers_ready = True


def resolve(db, identifier):
    current = ready(db)
    return db.scalar(text("""
        SELECT a.user_id FROM staff_login_identifiers a
        JOIN account_identifier_reservations r ON r.identifier_index=a.identifier_index AND r.user_id=a.user_id
        JOIN staff_profiles s ON s.user_id=a.user_id
        JOIN users u ON u.id=a.user_id AND u.system_role IS NULL AND NOT u.is_protected_system_admin
        WHERE a.identifier_index=:digest AND s.login_identifiers_ready
    """), {"digest": current.lookup_index(identifier.lower())})
