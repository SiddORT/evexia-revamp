import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import jwt
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    access_token, decode_access, hash_password, new_refresh_token, token_digest, utcnow,
    verify_password,
)
from app.db.models import AuditEvent, AuthSession, LoginAttempt, MRProfile, RefreshSession, User
from app.repositories import sessions as repository
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
    session_id: str | None = None
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


def _reject(db: Session, action: str, reason: str, request_id: str | None,
            user_id: uuid.UUID | None = None, session_id: str | None = None) -> None:
    # Rejection is itself a security outcome; commit it before raising. These
    # entry points run before application mutations and own this transaction.
    repository.event(db, action, "failure", request_id, user_id, session_id, reason)
    db.commit()
    raise AuthError()


def _effective_session(db: Session, session: AuthSession | None, user: User,
                       request_id: str | None, *, commit_expiry: bool = False) -> bool:
    if not session or session.user_id != user.id or session.status != "ACTIVE":
        return False
    if session.expires_at <= utcnow():
        session.status = "EXPIRED"
        repository.event(db, "session_expired", "success", request_id, user.id, session.id)
        if commit_expiry:
            db.commit()
        return False
    return (session.token_version == user.token_version
            and session.identity_version == user.identity_version)


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
    # Password verification happened without a lock; serialize creation against
    # password/identity changes and reject a stale password snapshot.
    password_snapshot = user.password_hash
    locked = repository.lock_user(db, user.id)
    if (not locked or locked.password_hash != password_snapshot
            or locked.token_version != identity._token_version_snapshot
            or locked.identity_version != identity._identity_version_snapshot):
        _reject(db, "login", "identity_changed", request_id)
    identity = _load_identity(db, locked)
    now = utcnow()
    session = AuthSession(
        id=secrets.token_urlsafe(32), user_id=locked.id, family_id=uuid.uuid4(),
        status="ACTIVE", token_version=locked.token_version,
        identity_version=locked.identity_version, persistent=remember_me, created_at=now,
        expires_at=now + (timedelta(days=settings.refresh_token_days)
                               if remember_me else timedelta(hours=settings.session_refresh_hours)),
    )
    db.add(session)
    db.flush()
    token = create_refresh(db, identity, settings, session=session)
    repository.event(db, "session_created", "success", request_id, locked.id, session.id)
    repository.event(db, "login_success", "success", request_id, locked.id, session.id)
    audit(db, "login", request_id, "success", identity)
    db.execute(delete(LoginAttempt).where(LoginAttempt.identifier_hash == identifier_key))
    db.commit()
    return Identity(identity.user, identity.mr, session.id), token


# A valid Argon2id hash prevents a non-existent account from skipping expensive verification.
_DUMMY_HASH = hash_password("not-a-real-account-password")


def create_refresh(db: Session, identity: Identity, settings: Settings,
                   family_id: uuid.UUID | None = None, persistent: bool = False,
                   family_expires_at: datetime | None = None,
                   session: AuthSession | None = None) -> str:
    if session is None:
        raise ValueError("A refresh credential must be bound to a persistent session")
    value = new_refresh_token()
    absolute_expiry = session.expires_at
    db.add(RefreshSession(
        token_hash=token_digest(value), user_id=identity.user.id,
        organization_id=None, identity_version=identity.user.identity_version,
        family_id=session.family_id, session_id=session.id,
        expires_at=absolute_expiry, family_expires_at=absolute_expiry,
        persistent=session.persistent,
    ))
    return value


def identity_from_token(db: Session, token: str, settings: Settings) -> Identity:
    request_id = db.info.get("request_id")
    try:
        claims = decode_access(token, settings)
        if (claims["typ"] != "access" or type(claims["ver"]) is not int
                or type(claims["identity_version"]) is not int or "org" in claims
                or not isinstance(claims["sid"], str) or not 32 <= len(claims["sid"]) <= 64
                or not isinstance(claims["jti"], str)):
            raise AuthError()
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError, TypeError, AuthError):
        _reject(db, "token_validation_failure", "invalid_token", request_id)
    user = db.get(User, user_id)
    if (not user or not user.is_active or user.token_version != claims["ver"]
            or user.identity_version != claims["identity_version"]):
        _reject(db, "token_version_rejection", "identity_version", request_id)
    session = repository.get_session(db, claims["sid"])
    if not _effective_session(db, session, user, request_id, commit_expiry=True):
        _reject(db, "authentication_rejection", "session_invalid", request_id)
    try:
        identity = _load_identity(db, user)
    except AuthError:
        _reject(db, "authentication_rejection", "identity_invalid", request_id)
    return Identity(identity.user, identity.mr, session.id)


def revalidate_identity(db: Session, identity: Identity, lock: bool = False) -> Identity:
    """Reload and validate an identity for sensitive services; lock User before MR/Patient.

    File operations call this first with lock=True (actor User), then lock the
    owner User rows in stable ID order, then MRProfile/Patient, then file rows.
    Release all row locks before slow storage, parser, or scanner I/O.
    """
    if identity.session_id is None:
        raise AuthError()
    query = select(User).where(User.id == identity.user.id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    user = db.scalar(query)
    if (not user or not user.is_active or user.system_role != identity._role_snapshot
            or user.is_protected_system_admin != identity._protected_snapshot
            or user.identity_version != identity._identity_version_snapshot
            or user.token_version != identity._token_version_snapshot):
        raise AuthError()
    session = repository.get_session(db, identity.session_id, lock=lock)
    if not _effective_session(db, session, user, db.info.get("request_id")):
        raise AuthError()
    refreshed = _load_identity(db, user, lock=lock)
    if (refreshed.mr.id if refreshed.mr else None) != (identity.mr.id if identity.mr else None):
        raise AuthError()
    return Identity(refreshed.user, refreshed.mr, identity.session_id)


def rotate_refresh(db: Session, value: str, settings: Settings, request_id: str) -> tuple[Identity, str]:
    digest = token_digest(value)
    # Unlocked lookup only obtains the trustworthy persisted owner. After
    # locking User -> Session -> credential, re-read all state under the locks.
    snapshot = repository.get_credential(db, digest)
    if snapshot is None:
        _reject(db, "refresh_rejected", "unknown", request_id)
    user = repository.lock_user(db, snapshot.user_id)
    session = repository.get_session(db, snapshot.session_id, lock=True)
    row = repository.get_credential(db, digest, lock=True)
    if row is None or row.session_id != snapshot.session_id or not user or not session:
        _reject(db, "refresh_rejected", "invalid", request_id)
    if row.consumed_at or row.revoked_at:
        repository.event(db, "refresh_reuse", "failure", request_id, user.id, session.id, "replayed")
        repository.revoke_session(db, session, "replay", request_id)
        db.commit()
        raise AuthError()
    if (not user.is_active or row.identity_version != user.identity_version
            or not _effective_session(db, session, user, request_id)):
        _reject(db, "refresh_rejected", "session_invalid", request_id, user.id, session.id)
    if (row.organization_id is not None or row.user_id != user.id
            or row.family_id != session.family_id or row.expires_at <= utcnow()
            or row.family_expires_at <= utcnow()):
        _reject(db, "refresh_rejected", "expired_or_invalid", request_id, user.id, session.id)
    try:
        identity = _load_identity(db, user)
    except AuthError:
        _reject(db, "refresh_rejected", "identity_invalid", request_id, user.id, session.id)
    now = utcnow()
    row.consumed_at = now
    new_value = create_refresh(db, identity, settings, session=session)
    db.flush()
    successor = repository.get_credential(db, token_digest(new_value))
    row.replaced_by_id = successor.id
    session.last_refreshed_at = now
    repository.event(db, "refresh_rotated", "success", request_id, user.id, session.id)
    repository.event(db, "session_refreshed", "success", request_id, user.id, session.id)
    repository.event(db, "refresh_success", "success", request_id, user.id, session.id)
    audit(db, "refresh", request_id, "success", identity)
    db.commit()
    return Identity(identity.user, identity.mr, session.id), new_value


def logout(db: Session, value: str | None, request_id: str) -> None:
    if value:
        digest = token_digest(value)
        snapshot = repository.get_credential(db, digest)
        if snapshot and snapshot.session_id is None and snapshot.revoked_at is not None:
            # Historical refresh rows revoked during the session migration are
            # intentionally unbound. They cannot identify a session to revoke;
            # treating their replay as an invalid-session failure would create
            # noisy audit events for harmless legacy sign-out retries.
            pass
        elif snapshot:
            # Use the persisted credential only to discover the lock order and
            # candidate owner. Re-read it after User -> Session locks before
            # making any state change, just as refresh rotation does.
            user = repository.lock_user(db, snapshot.user_id)
            session = repository.get_session(db, snapshot.session_id, lock=True)
            row = repository.get_credential(db, digest, lock=True)
            if (not user or not session or not row
                    or row.user_id != snapshot.user_id
                    or row.session_id != snapshot.session_id
                    or session.user_id != snapshot.user_id
                    or session.id != snapshot.session_id):
                # A valid stored credential that no longer resolves to its
                # persisted owner is meaningful unexpected state. Never use a
                # request-supplied identifier to recover or broaden authority.
                repository.event(
                    db, "logout", "failure", request_id,
                    user_id=snapshot.user_id, session_id=snapshot.session_id,
                    reason="invalid_session",
                )
            elif session.status != "REVOKED":
                # Even an expired or previously-consumed refresh credential
                # identifies only its own session. Revoking the session also
                # invalidates every credential in that session's chain.
                transitioned = repository.revoke_session(db, session, "logout", request_id)
                if transitioned:
                    repository.event(
                        db, "logout", "success", request_id,
                        user_id=user.id, session_id=session.id,
                        reason="expired" if session.expires_at <= utcnow() else None,
                    )
    db.commit()


def change_password(db: Session, identity: Identity, current: str, new: str,
                    request_id: str) -> None:
    identity = revalidate_identity(db, identity, lock=True)
    user = identity.user
    if current == new or not verify_password(current, user.password_hash):
        raise AuthError()
    user.password_hash = hash_password(new)
    user.token_version += 1
    repository.revoke_user_sessions(db, user.id, "password_change", request_id)
    repository.event(db, "session_security_changed", "success", request_id, user.id, identity.session_id)
    audit(db, "password_change", request_id, "success", identity)
    db.commit()


def token_response(identity: Identity, settings: Settings) -> TokenResponse:
    if identity.session_id is None:
        raise AuthError()
    return TokenResponse(
        access_token=access_token(
            identity.user.id, identity.user.token_version, identity.user.identity_version, settings,
            identity.session_id,
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