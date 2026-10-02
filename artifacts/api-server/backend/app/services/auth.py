import hashlib
import hmac
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import jwt
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    access_token, decode_access, hash_password, new_refresh_token, token_digest, utcnow,
    verify_password,
)
from app.db.models import AuditEvent, LoginAttempt, MRProfile, RefreshSession, User
from app.schemas.auth import CurrentUser, TokenResponse


class AuthError(Exception):
    pass


class TooManyAttempts(Exception):
    pass


class RegistrationUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    user: User
    mr: MRProfile | None = None
    _role_snapshot: str | None = field(init=False, repr=False)
    _protected_snapshot: bool = field(init=False, repr=False)
    _token_version_snapshot: int = field(init=False, repr=False)
    _identity_version_snapshot: int = field(init=False, repr=False)

    def __post_init__(self) -> None:
        # ORM entities are mutable; preserve the authenticated snapshot independently
        # so revalidation can notice changes even in the same SQLAlchemy identity map.
        object.__setattr__(self, "_role_snapshot", self.user.system_role)
        object.__setattr__(self, "_protected_snapshot", self.user.is_protected_system_admin)
        object.__setattr__(self, "_token_version_snapshot", self.user.token_version)
        object.__setattr__(self, "_identity_version_snapshot", self.user.identity_version)

    @property
    def role(self) -> str | None:
        return self.user.system_role

    @property
    def permissions(self) -> frozenset[str]:
        if (self.user.is_protected_system_admin and self.user.is_active
                and self.user.system_role == "super_admin"):
            return frozenset({"admin.access", "domain.provision", "domain.assign_patient"})
        return frozenset()

    def public(self) -> CurrentUser:
        return CurrentUser(
            id=self.user.id, email=self.user.email, username=self.user.username,
            system_role=self.user.system_role, mr_id=self.mr.id if self.mr else None,
            permissions=sorted(self.permissions),
        )


def audit(db: Session, action: str, request_id: str, outcome: str, identity: Identity | None = None) -> None:
    # organization_id is intentionally unset for all new system-identity events.
    db.add(AuditEvent(
        action=action, outcome=outcome, request_id=request_id,
        actor_id=identity.user.id if identity else None,
        resource_type="user" if identity else None,
        resource_id=identity.user.id if identity else None,
    ))


def _limit_key(settings: Settings, scope: str, identifier: str) -> str:
    return hmac.new(settings.signing_key.encode(), f"{scope}:{identifier}".encode(), hashlib.sha256).hexdigest()


def limit_state(db: Session, settings: Settings, scope: str, identifier: str, max_attempts: int) -> tuple[str, bool]:
    key = _limit_key(settings, scope, identifier)
    # Serialize competing attempts on PostgreSQL so parallel requests cannot bypass the limit.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})
    since = utcnow() - timedelta(minutes=15)
    count = db.scalar(select(func.count()).select_from(LoginAttempt).where(
        LoginAttempt.identifier_hash == key, LoginAttempt.attempted_at >= since,
    ))
    return key, count >= max_attempts


def record_attempt(db: Session, *keys: str) -> None:
    for key in keys:
        db.add(LoginAttempt(identifier_hash=key))


def register(*_args, **_kwargs):
    """Public registration must never grant system access."""
    raise RegistrationUnavailable()


def _load_identity(db: Session, user: User, lock: bool = False) -> Identity:
    if user.system_role not in ("super_admin", "mr") or not user.is_active:
        raise AuthError()
    if (user.system_role == "super_admin") != user.is_protected_system_admin:
        raise AuthError()
    profile_query = select(MRProfile).where(
        MRProfile.user_id == user.id,
    ).execution_options(populate_existing=True)
    if lock:
        profile_query = profile_query.with_for_update()
    mr = db.scalar(profile_query) if user.system_role == "mr" else None
    if user.system_role == "mr" and (mr is None or not mr.is_active):
        raise AuthError()
    return Identity(user, mr)


def login(db: Session, identifier: str, password: str, settings: Settings,
          remember_me: bool, request_id: str, ip: str) -> tuple[Identity, str]:
    identifier = identifier.lower()
    identifier_key, identifier_blocked = limit_state(db, settings, "login-identifier", identifier, 5)
    ip_key, ip_blocked = limit_state(db, settings, "login-ip", ip, 30)
    user = db.scalar(select(User).where(or_(User.email == identifier, User.username == identifier)))
    valid = verify_password(password, user.password_hash) if user else verify_password(
        password, _DUMMY_HASH,
    )
    identity = None
    if user and valid and user.is_active:
        try:
            identity = _load_identity(db, user)
        except AuthError:
            pass
    if not identity or identifier_blocked or ip_blocked:
        record_attempt(db, identifier_key, ip_key)
        audit(db, "login", request_id, "rate_limited" if identifier_blocked or ip_blocked else "failure")
        db.commit()
        if identifier_blocked or ip_blocked:
            raise TooManyAttempts()
        raise AuthError()
    token = create_refresh(db, identity, settings, persistent=remember_me)
    audit(db, "login", request_id, "success", identity)
    db.execute(delete(LoginAttempt).where(LoginAttempt.identifier_hash == identifier_key))
    db.commit()
    return identity, token


# A valid Argon2id hash prevents a non-existent account from skipping expensive verification.
_DUMMY_HASH = hash_password("not-a-real-account-password")


def create_refresh(db: Session, identity: Identity, settings: Settings,
                   family_id: uuid.UUID | None = None, persistent: bool = False,
                   family_expires_at: datetime | None = None) -> str:
    value = new_refresh_token()
    now = utcnow()
    absolute_expiry = family_expires_at or now + (
        timedelta(days=settings.refresh_token_days) if persistent
        else timedelta(hours=settings.session_refresh_hours)
    )
    db.add(RefreshSession(
        token_hash=token_digest(value), user_id=identity.user.id,
        organization_id=None, identity_version=identity.user.identity_version,
        family_id=family_id or uuid.uuid4(),
        expires_at=absolute_expiry, family_expires_at=absolute_expiry,
        persistent=persistent,
    ))
    return value


def identity_from_token(db: Session, token: str, settings: Settings) -> Identity:
    try:
        claims = decode_access(token, settings)
        if (claims["typ"] != "access" or type(claims["ver"]) is not int
                or type(claims["identity_version"]) is not int or "org" in claims):
            raise AuthError()
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise AuthError() from None
    user = db.get(User, user_id)
    if (not user or not user.is_active or user.token_version != claims["ver"]
            or user.identity_version != claims["identity_version"]):
        raise AuthError()
    return _load_identity(db, user)


def revalidate_identity(db: Session, identity: Identity, lock: bool = False) -> Identity:
    """Reload and validate an identity for sensitive services; lock User before MR/Patient.

    File operations call this first with lock=True (actor User), then lock the
    owner User rows in stable ID order, then MRProfile/Patient, then file rows.
    Release all row locks before slow storage, parser, or scanner I/O.
    """
    query = select(User).where(User.id == identity.user.id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    user = db.scalar(query)
    if (not user or not user.is_active or user.system_role != identity._role_snapshot
            or user.is_protected_system_admin != identity._protected_snapshot
            or user.identity_version != identity._identity_version_snapshot
            or user.token_version != identity._token_version_snapshot):
        raise AuthError()
    refreshed = _load_identity(db, user, lock=lock)
    if (refreshed.mr.id if refreshed.mr else None) != (identity.mr.id if identity.mr else None):
        raise AuthError()
    return refreshed


def rotate_refresh(db: Session, value: str, settings: Settings, request_id: str) -> tuple[Identity, str]:
    row = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == token_digest(value),
    ).with_for_update())
    if not row:
        raise AuthError()
    if row.revoked_at:
        db.execute(update(RefreshSession).where(
            RefreshSession.family_id == row.family_id,
        ).values(revoked_at=utcnow()))
        audit(db, "refresh_reuse", request_id, "failure")
        db.commit()
        raise AuthError()
    if (row.expires_at <= utcnow() or row.family_expires_at <= utcnow()
            or row.organization_id is not None):
        raise AuthError()
    user = db.get(User, row.user_id)
    if (not user or not user.is_active or row.identity_version != user.identity_version):
        raise AuthError()
    try:
        identity = _load_identity(db, user)
    except AuthError:
        raise AuthError() from None
    row.revoked_at = utcnow()
    new_value = create_refresh(
        db, identity, settings, row.family_id, row.persistent, row.family_expires_at,
    )
    audit(db, "refresh", request_id, "success", identity)
    db.commit()
    return identity, new_value


def logout(db: Session, value: str | None, request_id: str) -> None:
    if value:
        row = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == token_digest(value),
        ).with_for_update())
        if row and not row.revoked_at:
            db.execute(update(RefreshSession).where(
                RefreshSession.family_id == row.family_id,
                RefreshSession.revoked_at.is_(None),
            ).values(revoked_at=utcnow()))
            db.add(AuditEvent(
                action="logout", outcome="success", request_id=request_id,
                actor_id=row.user_id, organization_id=None,
                resource_type="user", resource_id=row.user_id,
            ))
    db.commit()


def change_password(db: Session, identity: Identity, current: str, new: str,
                    request_id: str) -> None:
    identity = revalidate_identity(db, identity, lock=True)
    user = identity.user
    if current == new or not verify_password(current, user.password_hash):
        raise AuthError()
    user.password_hash = hash_password(new)
    user.token_version += 1
    db.execute(update(RefreshSession).where(
        RefreshSession.user_id == identity.user.id, RefreshSession.revoked_at.is_(None),
    ).values(revoked_at=utcnow()))
    audit(db, "password_change", request_id, "success", identity)
    db.commit()


def token_response(identity: Identity, settings: Settings) -> TokenResponse:
    return TokenResponse(
        access_token=access_token(
            identity.user.id, identity.user.token_version, identity.user.identity_version, settings,
        ),
        expires_in=settings.access_token_minutes * 60,
        user=identity.public(),
    )


def refresh_session(db: Session, value: str) -> RefreshSession:
    row = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == token_digest(value),
    ))
    if row is None:
        raise AuthError()
    return row