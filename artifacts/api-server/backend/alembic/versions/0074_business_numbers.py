"""Align business labels without deleting accounts, orders or UUID references.

Existing encrypted audit/history records are deliberately not rewritten.
Employee-Code changes preserve retired reservations and invalidate affected
staff sessions, just like the ordinary identifier-edit path.
"""
import re
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = "0074_business_numbers"
down_revision = "0073_order_decisions"
branch_labels = depends_on = None


def upgrade():
    from app.services.business_numbers import format_number, align_suborders
    connection = op.get_bind()
    connection.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    connection.execute(sa.text(
        "LOCK TABLE immunotherapy_orders,kits_orders,spt_orders,lupin_orders,"
        "allergen_products,patient_directory,patients,staff_profiles,users,account_identifier_reservations,"
        "staff_login_identifiers IN SHARE ROW EXCLUSIVE MODE"))
    op.execute("CREATE SEQUENCE allergen_number_seq AS bigint")
    op.execute("CREATE SEQUENCE staff_employee_number_seq AS bigint")
    op.add_column("allergen_products", sa.Column("code", sa.String(32), nullable=True))
    for row in connection.execute(sa.text(
            "SELECT id FROM allergen_products ORDER BY created_at,id")).all():
        number = connection.scalar(sa.text("SELECT nextval('allergen_number_seq')"))
        connection.execute(sa.text("UPDATE allergen_products SET code=:code WHERE id=:id"),
                           {"code": format_number("allergen", number), "id": row.id})
    op.alter_column("allergen_products", "code", nullable=False)
    op.create_unique_constraint("uq_allergen_products_code", "allergen_products", ["code"])

    # Patient imports previously accepted authored codes. Retain UUID ownership
    # and clinical relationships while giving nonnumeric dummy codes a number.
    for row in connection.execute(sa.text(
            "SELECT id,code FROM patient_directory ORDER BY created_at,id FOR UPDATE")).all():
        if re.fullmatch(r"PAT-[0-9]{3,}", row.code) and int(row.code[4:]) > 0:
            continue
        while True:
            number = connection.scalar(sa.text("SELECT nextval('patient_number_seq')"))
            code = format_number("patient", number)
            if not connection.scalar(sa.text(
                    "SELECT 1 FROM patient_directory WHERE code=:code"), {"code": code}):
                break
        connection.execute(sa.text("UPDATE patient_directory SET code=:code WHERE id=:id"),
                           {"code": code, "id": row.id})
        connection.execute(sa.text("UPDATE patients SET version=version+1 WHERE id=:id"),
                           {"id": row.id})

    # Abort rather than guess about unrecognized or colliding historical labels.
    for kind, table in (
        ("immunotherapy", "immunotherapy_orders"), ("kits", "kits_orders"),
        ("spt", "spt_orders"), ("lupin", "lupin_orders"),
    ):
        changes, targets = [], set()
        expected = {"immunotherapy": "IT", "kits": "KIT", "spt": "SPT", "lupin": "LUP"}[kind]
        for row in connection.execute(sa.text(f"SELECT id,number FROM {table} FOR UPDATE")).all():
            match = re.fullmatch(expected + r"-([0-9]+)", row.number, re.IGNORECASE)
            if not match or int(match[1]) < 1:
                raise RuntimeError(f"Unrecognized {kind} number; explicit record review required")
            number = format_number(kind, int(match[1]))
            if number in targets:
                raise RuntimeError(f"Conflicting {kind} numbers; explicit record review required")
            targets.add(number)
            changes.append((row.id, number, row.number))
        # A target already present would have the same numeric ordinal and was
        # rejected above. No temporary labels or relaxed constraints are needed.
        for identity, number, old in changes:
            if number != old:
                connection.execute(sa.text(
                    f"UPDATE {table} SET number=:number,version=version+1 WHERE id=:id"),
                    {"number": number, "id": identity})

    from app.core.config import get_settings
    from app.services.directory_crypto import DirectoryCrypto
    from app.services import immunotherapy
    keys = DirectoryCrypto(get_settings())
    for row in connection.execute(sa.text(
            "SELECT id,number,snapshot_ciphertext FROM immunotherapy_orders FOR UPDATE")).all():
        old = immunotherapy.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
        value = align_suborders(old, row.number)
        if value != old:
            connection.execute(sa.text(
                "UPDATE immunotherapy_orders SET snapshot_ciphertext=:data,version=version+1 WHERE id=:id"),
                {"id": row.id, "data": immunotherapy.seal(keys, "orders", row.id, value)})

    # Use the supported encrypted alias reservation path; preserve EVX usernames,
    # hashes, roles and the protected administrator. Deleted history stays intact.
    from app.db.staff_models import StaffProfile
    from app.db.models import User
    from app.services.staff_crypto import StaffCrypto
    from app.services.staff_employee_numbers import allocate
    from app.services.staff_identifiers import save_identifiers
    from app.repositories import sessions
    db = Session(bind=connection, join_transaction_mode="rollback_only")
    crypto = StaffCrypto(get_settings())
    try:
        highest = db.scalar(sa.text(
            "SELECT max(substring(employee_code from 4)::bigint) FROM staff_profiles "
            "WHERE employee_code ~ '^ST-[0-9]{3,}$'"))
        if highest:
            db.execute(sa.text("SELECT setval('staff_employee_number_seq',:value,true)"),
                       {"value": highest})
        rows = db.scalars(sa.select(StaffProfile).join(User, User.id == StaffProfile.user_id).where(
            StaffProfile.deleted_at.is_(None), User.system_role.is_(None),
            User.is_protected_system_admin.is_(False), User.email_ciphertext.is_(None)
        ).order_by(StaffProfile.created_at, StaffProfile.id)).all()
        for profile in rows:
            if (re.fullmatch(r"ST-[0-9]{3,}", profile.employee_code or "")
                    and int(profile.employee_code[3:]) > 0):
                continue
            code = allocate(db)
            with db.no_autoflush:
                save_identifiers(db, profile, crypto.decrypt(profile.id, "email", profile.email_ciphertext),
                                 code, crypto)
                profile.employee_code = code
            profile.version += 1
            user = db.get(User, profile.user_id)
            user.identity_version += 1
            sessions.revoke_user_sessions(db, user.id, "identity_invalid", None)
            db.flush()
    finally:
        db.close()


def downgrade():
    raise RuntimeError("Business-number history and retained login reservations must not be recycled")
