"""Approved Admin mailbox transfer; keep both account identities intact."""
import hmac

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = "0080_admin_email"
down_revision = "0079_order_notifications"
branch_labels = depends_on = None

OLD_ADMIN = "crm-admin@allergyevexia.in"
NEW_ADMIN = "reena.ai20206@gmail.com"
NEW_MR = "reenamaisheri31@gmail.com"


def upgrade():
    from app.db.models import AuditEvent, MRProfile, User
    from app.db.mr_models import MRDirectory
    from app.services.account_crypto import AccountCryptoError, ready, read

    db = op.get_bind()
    db.execute(sa.text("SELECT pg_advisory_xact_lock(hashtextextended('evexia:zone-policy:v1',0))"))
    db.execute(sa.text("SELECT pg_advisory_xact_lock(73182451)"))
    db.execute(sa.text(
        "LOCK TABLE users, staff_profiles, account_identifier_reservations, "
        "staff_login_identifiers, account_crypto_state, mr_profiles, mr_directory "
        "IN ACCESS EXCLUSIVE MODE"))
    with Session(bind=db, join_transaction_mode="rollback_only", expire_on_commit=False) as session:
        current = ready(session)
        old_index = current.lookup_index(OLD_ADMIN)
        new_index = current.lookup_index(NEW_ADMIN)
        mr_index = current.lookup_index(NEW_MR)
        admins = list(session.scalars(sa.select(User).where(User.is_protected_system_admin)))
        if len(admins) > 1:
            raise AccountCryptoError("Protected Admin identity requires operator review.")
        admin = admins[0] if admins else None
        if admin and (admin.email != OLD_ADMIN or admin.system_role != "super_admin" or not admin.is_active):
            raise AccountCryptoError("Unexpected protected Admin identity; no changes applied.")

        # Only the explicitly approved MR-004 may release this mailbox.
        owners = list(session.scalars(sa.select(User).where(
            sa.or_(User.email_index == new_index, User.username_index == new_index))))
        if len(owners) > 1:
            raise AccountCryptoError("Mailbox ownership conflicts; no changes applied.")
        mr = owners[0] if owners else None
        profile = None
        if mr:
            if (mr.system_role != "mr" or mr.is_protected_system_admin
                    or mr.username != "MR-004" or mr.email != NEW_ADMIN):
                raise AccountCryptoError("Mailbox is not owned by the approved MR account.")
            profile = session.scalar(sa.select(MRProfile).where(MRProfile.user_id == mr.id))
            directory = session.get(MRDirectory, profile.id) if profile else None
            if not directory or directory.deleted_at or directory.email != NEW_ADMIN:
                raise AccountCryptoError("MR mailbox/profile linkage requires operator review.")
            # A retained alias counts as ownership, not merely a current login.
            for query in (
                "SELECT id FROM users WHERE email_index=:digest OR username_index=:digest",
                "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest",
                "SELECT user_id FROM staff_login_identifiers WHERE identifier_index=:digest",
            ):
                if any(owner != mr.id for owner in db.execute(
                        sa.text(query), {"digest": mr_index}).scalars()):
                    raise AccountCryptoError("Replacement MR mailbox is already owned or reserved.")
        reservation = db.execute(sa.text(
            "SELECT user_id,field,identifier FROM account_identifier_reservations "
            "WHERE identifier_index=:digest"), {"digest": new_index}).mappings().one_or_none()
        if reservation and (not mr or reservation["user_id"] != mr.id
                            or reservation["field"] != "email"
                            or read(mr.id, "email", reservation["identifier"], new_index) != NEW_ADMIN):
            raise AccountCryptoError("Mailbox reservation is not the approved MR ownership.")
        if mr and (not admin or not reservation):
            raise AccountCryptoError("Mailbox transfer requires both existing accounts and reservation.")
        if db.scalar(sa.text(
                "SELECT user_id FROM staff_login_identifiers WHERE identifier_index=:digest"),
                {"digest": new_index}) is not None:
            raise AccountCryptoError("Mailbox has a staff login alias; no changes applied.")

        if mr:
            mr.email = NEW_MR
            directory.email = NEW_MR
            directory.version += 1
            session.add(AuditEvent(actor_id=None, action="mr_email_changed", outcome="success",
                                   resource_type="user", resource_id=mr.id))
            session.flush()
            # Explicit owner-approved transfer of this one encrypted reservation.
            # Re-encrypt for the Admin UUID/AAD; never reuse the MR ciphertext.
            db.execute(sa.text(
                "UPDATE account_identifier_reservations SET user_id=:owner,identifier=:ciphertext "
                "WHERE identifier_index=:digest AND user_id=:previous"),
                {"owner": admin.id, "ciphertext": current.encrypt(admin.id, "email", NEW_ADMIN),
                 "digest": new_index, "previous": mr.id})

        original = db.scalar(sa.text(
            "SELECT pg_get_functiondef('evexia_protect_super_admin()'::regprocedure)"))
        # The existing guard stays installed. Under exclusive locks allow only
        # this exact old->new email transition, preserving every other field.
        # Restore its exact original definition before committing.
        transition = (f"(OLD.email_index = '{old_index}' AND NEW.email_index = '{new_index}' "
                      "AND NEW.id = OLD.id)")
        temporary = original
        for expression in ("NEW.email IS DISTINCT FROM OLD.email",
                           "NEW.email_index IS DISTINCT FROM OLD.email_index"):
            if temporary.count(expression) != 1:
                raise AccountCryptoError("Unexpected protected identity guard; no changes applied.")
            temporary = temporary.replace(expression, f"({expression} AND NOT {transition})")
        db.execute(sa.text(temporary))
        db.execute(sa.text(
            "UPDATE account_crypto_state SET protected_email_index=:digest WHERE id=1"),
            {"digest": new_index})
        if admin:
            db.execute(sa.text("UPDATE users SET email=:ciphertext,email_index=:digest WHERE id=:owner"),
                       {"ciphertext": current.encrypt(admin.id, "email", NEW_ADMIN),
                        "digest": new_index, "owner": admin.id})
            for digest in (old_index, new_index):
                if db.scalar(sa.text(
                        "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"),
                        {"digest": digest}) != admin.id:
                    raise AccountCryptoError("Admin reservation verification failed.")
            # Audit before commit without ORM-loading the now changed account.
            session.add(AuditEvent(actor_id=None, action="super_admin_email_changed", outcome="success",
                                   resource_type="user", resource_id=admin.id))
            # AccountCrypto readiness still sees the predecessor revision until
            # Alembic finishes; AuditEvent has no encrypted identifier mutations.
            session.flush()
        db.execute(sa.text(original))
        restored = db.scalar(sa.text(
            "SELECT pg_get_functiondef('evexia_protect_super_admin()'::regprocedure)"))
        if not hmac.compare_digest(original, restored):
            raise AccountCryptoError("Protected identity guard restoration failed.")


def downgrade():
    raise RuntimeError("Mailbox transfer downgrade is refused; use a reviewed forward change.")
