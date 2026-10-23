"""Sequential encrypted staff account labels; preserve all login aliases/history."""
import re

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

revision = "0060_staff_account_numbers"
down_revision = "0059_staff_unified_access"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    # Same order as staff mutations; exclude all namespace and alias writers.
    db.execute(sa.text("SELECT pg_advisory_xact_lock(hashtextextended('evexia:zone-policy:v1',0))"))
    db.execute(sa.text("SELECT pg_advisory_xact_lock(73182451)"))
    db.execute(sa.text(
        "LOCK TABLE users, staff_profiles, account_identifier_reservations, "
        "staff_login_identifiers IN ACCESS EXCLUSIVE MODE"))
    from app.db.models import User
    from app.db.staff_models import StaffProfile
    from app.services.account_crypto import ready, read, AccountCryptoError
    from app.services.staff_account_numbers import ADMIN_NUMBER, allocate, assert_available

    # Use the existing validated ORM encrypted mutation path in the caller's
    # migration transaction. No bulk plaintext or ciphertext identifier updates.
    with Session(bind=db, join_transaction_mode="rollback_only", expire_on_commit=False) as session:
        current = ready(session)
        maximum, numeric_owners = 1, {}

        def occupied(value, owner):
            nonlocal maximum
            if not value or not re.fullmatch(r"EVX-[0-9]+", value, re.IGNORECASE):
                return
            number = int(value[4:])
            if number < 1 or number > 9223372036854775806:
                raise AccountCryptoError("EVX numeric range requires operator review.")
            if number in numeric_owners and numeric_owners[number] != owner:
                raise AccountCryptoError("Conflicting historical EVX number ownership requires operator review.")
            numeric_owners[number] = owner
            maximum = max(maximum, number)

        for row in session.execute(sa.text(
            "SELECT user_id,field,identifier,identifier_index FROM account_identifier_reservations"
        )).mappings():
            occupied(read(row["user_id"], row["field"], row["identifier"], row["identifier_index"]),
                     row["user_id"])
        for code, owner in session.execute(sa.select(StaffProfile.employee_code, StaffProfile.user_id)):
            occupied(code, owner)
        protected = session.scalar(sa.select(User).where(User.is_protected_system_admin))
        if 1 in numeric_owners and (protected is None or numeric_owners[1] != protected.id):
            raise AccountCryptoError("EVX-001 is owned by another retained identity; operator review is required.")
        if protected and (protected.system_role != "super_admin"
                          or protected.email != "crm-admin@allergyevexia.in" or not protected.is_active):
            raise AccountCryptoError()

        db.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS staff_account_number_seq AS bigint MINVALUE 2 START WITH 2 NO CYCLE"))
        if maximum >= 2:
            db.execute(sa.text(
                "SELECT setval('staff_account_number_seq', greatest(:maximum,last_value), true) "
                "FROM staff_account_number_seq"),
                       {"maximum": maximum})

        # The protected identity stays immutable after this single transactional
        # backfill. Only omit its username comparisons while holding write locks;
        # all email, UUID, role, activity and identity-version guards remain.
        original = db.scalar(sa.text(
            "SELECT pg_get_functiondef('evexia_protect_super_admin()'::regprocedure)"))
        temporary = original
        for fragment in (
            "OR NEW.username IS DISTINCT FROM OLD.username ",
            "OR NEW.username_index IS DISTINCT FROM OLD.username_index ",
        ):
            if temporary.count(fragment) != 1:
                raise AccountCryptoError("Protected identity guard differs from the reviewed schema.")
            temporary = temporary.replace(fragment, "")
        # 0009 also protects staff usernames (now ciphertext) independently of
        # the protected Admin. Permit only this label comparison during the
        # locked backfill; retain UUID/profile immutability and restore the exact
        # original function before returning. PostgreSQL rolls DDL back with the
        # account updates if any later step fails.
        staff_original = db.scalar(sa.text(
            "SELECT pg_get_functiondef('evexia_staff_immutable_identity()'::regprocedure)"))
        staff_fragment = " OR NEW.username IS DISTINCT FROM OLD.username"
        if staff_original.count(staff_fragment) != 1:
            raise AccountCryptoError("Staff identity guard differs from the reviewed schema.")
        staff_temporary = staff_original.replace(staff_fragment, "")
        db.execute(sa.text(temporary))
        db.execute(sa.text(staff_temporary))

        def rename(user, value):
            assert_available(session, value, user.id)
            if user.username != value:
                user.username = value
                # Account-label maintenance is not a human profile edit.
                flag_modified(user, "updated_at")
                session.flush()

        if protected:
            rename(protected, ADMIN_NUMBER)
        # Include soft-deleted/inactive staff: their numbers remain retired.
        rows = session.execute(sa.select(User).join(StaffProfile, StaffProfile.user_id == User.id)
                               .order_by(StaffProfile.created_at, StaffProfile.id)).scalars()
        for user in rows:
            if user.system_role is not None or user.is_protected_system_admin or user.email is not None:
                raise AccountCryptoError("Staff account linkage requires operator review.")
            old = user.username
            if old and re.fullmatch(r"EVX-[0-9]+", old, re.IGNORECASE):
                number = int(old[4:])
                if number < 2:
                    raise AccountCryptoError("Staff cannot own the protected Admin number.")
                rename(user, f"EVX-{number:03d}")
            else:
                rename(user, allocate(session))
        db.execute(sa.text(original))
        db.execute(sa.text(staff_original))

        # Reserve 001 for bootstrap even on an empty installation. The digest is
        # derived with the validated account key and contains no plaintext PII.
        digest = current.lookup_index(ADMIN_NUMBER.lower())
        db.execute(sa.text(f"""
          CREATE OR REPLACE FUNCTION evexia_account_namespace() RETURNS trigger AS $$
          BEGIN
            PERFORM pg_advisory_xact_lock(73182451);
            IF (NOT NEW.is_protected_system_admin AND
                  '{digest}' IN (NEW.email_index,NEW.username_index))
              OR (NEW.email_index IS NOT NULL AND NEW.email_index = NEW.username_index)
              OR EXISTS (SELECT 1 FROM account_identifier_reservations r WHERE r.user_id <> NEW.id
                         AND r.identifier_index IN (NEW.email_index, NEW.username_index)) THEN
              RAISE EXCEPTION 'account identifier reserved' USING ERRCODE='23505',
                CONSTRAINT='uq_users_login_namespace';
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql;
        """))
        session.flush()


def downgrade():
    raise RuntimeError("Account numbers and retained ownership require forward recovery; never reset the sequence.")
