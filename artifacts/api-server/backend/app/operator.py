"""Trusted local operator identity mapper; never expose this module as an API."""
import argparse
import getpass
import re

from sqlalchemy import select, update

from app.bootstrap import SUPER_ADMIN_EMAIL
from app.core.security import hash_password, utcnow
from app.db.models import AuditEvent, MRProfile, RefreshSession, User
from app.db.session import session_factory


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly map EVEXIA system identities")
    parser.add_argument("--email", required=True, help="Account email to map")
    parser.add_argument("--role", choices=("mr", "none"), required=True,
                        help="Explicit target role; protected Super Admin is bootstrap-only")
    parser.add_argument("--username", help="Optional login username when creating an account")
    parser.add_argument("--create", action="store_true", help="Create the account (password is prompted securely)")
    args = parser.parse_args()
    email = args.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        parser.error("A valid email address is required")
    if args.username and not re.fullmatch(r"[a-z][a-z0-9._-]{2,31}", args.username.strip().lower()):
        parser.error("Invalid username")
    if email == SUPER_ADMIN_EMAIL:
        parser.error("The reserved Super Admin can only be initialized by app.bootstrap")
    new_password = None
    if args.create:
        if args.role == "none":
            parser.error("--create requires the MR system role")
        new_password = getpass.getpass("New account password: ")
        confirm = getpass.getpass("Confirm password: ")
        if new_password != confirm or len(new_password) < 12 or len(new_password) > 128:
            parser.error("Passwords must match and be 12 to 128 characters")

    with session_factory()() as db:
        user = db.scalar(select(User).where(User.email == email).with_for_update())
        if user is None:
            if not args.create:
                parser.error("Account does not exist; use --create to provision it")
            user = User(
                email=email,
                username=args.username.strip().lower() if args.username else None,
                password_hash=hash_password(new_password),
                system_role=None,
                identity_version=0,
            )
            db.add(user)
            db.flush()
        elif args.create:
            parser.error("Account already exists")

        if user.is_protected_system_admin or user.system_role == "super_admin":
            parser.error("Protected Super Admin identity can only be managed by the bootstrap service")

        profile = db.scalar(select(MRProfile).where(MRProfile.user_id == user.id).with_for_update())
        identity_changed = user.system_role != (None if args.role == "none" else args.role)
        if args.role == "mr":
            if profile is None:
                profile = MRProfile(user_id=user.id, is_active=True)
                db.add(profile)
                identity_changed = True
            else:
                identity_changed = identity_changed or not profile.is_active
                profile.is_active = True
        elif profile is not None:
            # Keep the profile row for FK/history safety; inactive profiles cannot authenticate.
            identity_changed = identity_changed or profile.is_active
            profile.is_active = False

        if identity_changed:
            user.system_role = None if args.role == "none" else args.role
            user.identity_version += 1
            user.token_version += 1
            from app.repositories import sessions as session_repository
            session_repository.revoke_user_sessions(db, user.id, "identity_change", None)
            session_repository.event(db, "session_security_changed", "success", None, user.id)
        db.add(AuditEvent(
            actor_id=None, action="operator_identity_mapping", outcome="success",
            resource_type="user", resource_id=user.id,
        ))
        db.commit()
        print(f"Mapped {email} as {args.role}.")


if __name__ == "__main__":
    main()