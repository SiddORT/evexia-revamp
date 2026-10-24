"""Number explicitly directory-backed MR logins without recycling ownership."""
import logging
import re

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

revision = "0070_mr_account_numbers"
down_revision = "0069_workspace_permissions"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    # Same policy -> directory graph -> account namespace order as MR writers.
    db.execute(sa.text("SELECT pg_advisory_xact_lock(hashtextextended('evexia:zone-policy:v1',0))"))
    db.execute(sa.text("SELECT pg_advisory_xact_lock(73182452)"))
    db.execute(sa.text("SELECT pg_advisory_xact_lock(73182451)"))
    db.execute(sa.text(
        "LOCK TABLE users,mr_profiles,mr_directory,account_identifier_reservations,"
        "staff_login_identifiers,staff_profiles IN ACCESS EXCLUSIVE MODE"))
    from app.db.models import User, MRProfile
    from app.db.mr_models import MRDirectory
    from app.services.account_crypto import ready, read, AccountCryptoError
    from app.services.master_numbers import allocate
    from app.repositories.sessions import revoke_user_sessions

    with Session(bind=db, join_transaction_mode="rollback_only", expire_on_commit=False) as session:
        current = ready(session)
        maximum, owners = 0, {}

        def occupied(value, owner):
            nonlocal maximum
            if not value or not re.fullmatch(r"MR-[0-9]+", value, re.IGNORECASE):
                return
            number = int(value[3:])
            if not 1 <= number <= 9223372036854775806:
                raise AccountCryptoError("MR numeric range requires explicit review.")
            if number in owners and owners[number] != owner:
                raise AccountCryptoError("Conflicting retained MR number ownership requires explicit review.")
            owners[number] = owner
            maximum = max(maximum, number)

        # Include retired identifiers, cross-field owners, and identity-only
        # accounts. No old reservation is removed or reassigned.
        for row in session.execute(sa.text(
            "SELECT user_id,field,identifier,identifier_index FROM account_identifier_reservations"
        )).mappings():
            occupied(read(row["user_id"], row["field"], row["identifier"], row["identifier_index"]),
                     row["user_id"])
        for user in session.scalars(sa.select(User).order_by(User.id)):
            occupied(user.username, user.id)
            occupied(user.email, user.id)
        for value, owner in session.execute(sa.text(
            "SELECT employee_code,user_id FROM staff_profiles"
        )):
            occupied(value, owner)
        # The sequence may be ahead because allocations are never rolled back.
        # Never lower it, reset is_called, or recycle gaps.
        db.execute(sa.text(
            "SELECT setval('mr_login_number_seq', greatest(last_value,:maximum),"
            "is_called OR :maximum >= last_value) FROM mr_login_number_seq"
        ), {"maximum": maximum})

        unsupported = session.scalar(sa.select(sa.func.count()).select_from(MRProfile).outerjoin(
            MRDirectory, MRDirectory.id == MRProfile.id,
        ).where(MRDirectory.id.is_(None)))
        if unsupported:
            # Counts only: do not log decrypted identifiers or personal data.
            logging.getLogger(__name__).warning(
                "%s identity-only MR profiles require explicit ownership review; left unchanged.",
                unsupported,
            )
        rows = session.execute(sa.select(User, MRDirectory.id).join(
            MRProfile, MRProfile.user_id == User.id,
        ).join(MRDirectory, MRDirectory.id == MRProfile.id).order_by(
            MRDirectory.created_at, MRDirectory.id,
        )).all()
        for user, directory_id in rows:
            if user.system_role != "mr" or user.is_protected_system_admin or not user.username:
                raise AccountCryptoError("MR directory ownership requires explicit review.")
            if re.fullmatch(r"MR-[0-9]{3,}", user.username, re.IGNORECASE):
                continue  # Preserve exact valid saved numbers, including case.
            if re.fullmatch(r"MR-[0-9]+", user.username, re.IGNORECASE):
                raise AccountCryptoError("Noncanonical existing MR number requires explicit review.")
            value = allocate(session, "mr")
            digest = current.lookup_index(value.lower())
            if session.scalar(sa.text(
                "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"
            ), {"digest": digest}) is not None or session.scalar(sa.select(User.id).where(
                sa.or_(User.username_index == digest, User.email_index == digest),
            )) is not None:
                raise AccountCryptoError("Allocated MR identifier is reserved; explicit review is required.")
            user.username = value  # Validated ciphertext/index setter + reservation trigger.
            user.identity_version += 1
            user.token_version += 1
            # Not a human profile edit; invalidate stale editors without claiming
            # a human updater, changing passwords, or rewriting historical data.
            flag_modified(user, "updated_at")
            revoke_user_sessions(session, user.id, "identity_change", None)
            session.execute(sa.text(
                "UPDATE mr_directory SET version=version+1 WHERE id=:id"
            ), {"id": directory_id})
            session.flush()


def downgrade():
    raise RuntimeError("MR login ownership and reservations require forward recovery; never reset numbers.")
