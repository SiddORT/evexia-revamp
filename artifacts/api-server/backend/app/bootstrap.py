"""One-time, idempotent bootstrap for the reserved system Super Admin."""
import argparse
import uuid
from dataclasses import dataclass

from pydantic import SecretStr
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AuditEvent, User
from app.db.session import session_factory

SUPER_ADMIN_EMAIL = "crm-admin@allergyevexia.in"
_BOOTSTRAP_LOCK_ID = 145001


class BootstrapConfigurationError(Exception):
    """A safe, non-sensitive bootstrap configuration or identity failure."""


@dataclass(frozen=True)
class BootstrapResult:
    user_id: uuid.UUID
    created: bool


def bootstrap_super_admin(db: Session, initial_password: SecretStr | None) -> BootstrapResult:
    """Create the protected singleton only if absent; never rotate existing credentials."""
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": _BOOTSTRAP_LOCK_ID})
        protected = db.scalar(
            select(User).where(User.is_protected_system_admin).with_for_update()
        )
        reserved_matches = list(db.scalars(
            select(User).where(or_(
                func.lower(User.email) == SUPER_ADMIN_EMAIL,
                func.lower(User.username) == SUPER_ADMIN_EMAIL,
            )).with_for_update()
        ))
        reserved = next((item for item in reserved_matches if item.email == SUPER_ADMIN_EMAIL), None)
        if protected is not None:
            if (len(reserved_matches) != 1 or protected.id != (reserved.id if reserved else None)
                    or protected.email != SUPER_ADMIN_EMAIL
                    or protected.system_role != "super_admin"
                    or not protected.is_active):
                raise BootstrapConfigurationError(
                    "Protected Super Admin identity conflicts with the reserved account; operator review is required"
                )
            _audit(db, protected.id, "existing")
            db.commit()
            return BootstrapResult(protected.id, created=False)
        if reserved_matches:
            raise BootstrapConfigurationError(
                "Reserved Super Admin identifier belongs to an unprotected account; operator review is required"
            )
        if initial_password is None:
            raise BootstrapConfigurationError(
                "SUPER_ADMIN_INITIAL_PASSWORD is required to create the protected Super Admin"
            )
        password = initial_password.get_secret_value()
        if not 12 <= len(password) <= 128:
            raise BootstrapConfigurationError(
                "SUPER_ADMIN_INITIAL_PASSWORD must be 12 to 128 characters for initial creation"
            )

        db.execute(text("SELECT set_config('evexia.bootstrap_super_admin', 'on', true)"))
        user = User(
            email=SUPER_ADMIN_EMAIL,
            password_hash=hash_password(password),
            is_active=True,
            token_version=0,
            system_role="super_admin",
            identity_version=1,
            is_protected_system_admin=True,
        )
        db.add(user)
        db.flush()
        _audit(db, user.id, "created")
        db.commit()
        return BootstrapResult(user.id, created=True)
    except BootstrapConfigurationError:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise BootstrapConfigurationError(
            "Protected Super Admin could not be created because an identity conflict exists; operator review is required"
        ) from None


def _audit(db: Session, user_id: uuid.UUID, outcome: str) -> None:
    db.add(AuditEvent(
        actor_id=None, action="super_admin_bootstrap", outcome=outcome,
        resource_type="user", resource_id=user_id,
    ))


def main() -> None:
    settings = get_settings()
    try:
        with session_factory()() as db:
            result = bootstrap_super_admin(db, settings.super_admin_initial_password)
    except BootstrapConfigurationError as exc:
        import sys

        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
    print("Protected Super Admin bootstrap complete." if result.created
          else "Protected Super Admin already exists; credentials and settings unchanged.")


if __name__ == "__main__":
    main()