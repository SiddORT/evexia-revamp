import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import timedelta

import jwt
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    access_token, decode_access, hash_password, new_refresh_token, token_digest, utcnow,
    verify_password,
)
from app.db.models import AuditEvent, LoginAttempt, Membership, Organization, RefreshSession, User
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
    membership: Membership

    def public(self) -> CurrentUser:
        return CurrentUser(
            id=self.user.id, email=self.user.email, username=self.user.username,
            organization_id=self.membership.organization_id, role=self.membership.role,
        )


def audit(db: Session, action: str, request_id: str, outcome: str, identity: Identity | None = None) -> None:
    db.add(AuditEvent(
        action=action, outcome=outcome, request_id=request_id,
        actor_id=identity.user.id if identity else None,
        organization_id=identity.membership.organization_id if identity else None,
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


def register(db: Session, email: str, username: str | None, password: str, organization_name: str, settings: Settings,
             request_id: str, ip: str) -> tuple[Identity, str]:
    if not settings.allow_public_registration:
        raise RegistrationUnavailable()
    key, blocked = limit_state(db, settings, "register-ip", ip, 5)
    if blocked:
        raise TooManyAttempts()
    if db.scalar(select(User.id).where(User.email == email.lower())):
        record_attempt(db, key)
        db.commit()
        raise RegistrationUnavailable()
    try:
        org = Organization(name=organization_name)
        user = User(email=email.lower(), username=username, password_hash=hash_password(password))
        db.add_all([org, user])
        db.flush()
        membership = Membership(user_id=user.id, organization_id=org.id, role="owner")
        db.add(membership)
        db.flush()
        identity = Identity(user, membership)
        token = create_refresh(db, identity, settings)
        record_attempt(db, key)
        audit(db, "register", request_id, "success", identity)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise RegistrationUnavailable() from None
    return identity, token


def login(db: Session, identifier: str, password: str, settings: Settings,
          request_id: str, ip: str) -> tuple[Identity, str]:
    identifier = identifier.lower()
    identifier_key, identifier_blocked = limit_state(db, settings, "login-identifier", identifier, 5)
    ip_key, ip_blocked = limit_state(db, settings, "login-ip", ip, 30)
    user = db.scalar(select(User).where(or_(User.email == identifier, User.username == identifier)))
    valid = verify_password(password, user.password_hash) if user else verify_password(
        password, _DUMMY_HASH,
    )
    membership = db.scalar(select(Membership).where(
        Membership.user_id == user.id, Membership.is_active.is_(True),
    ).order_by(Membership.created_at)) if user and valid and user.is_active else None
    if not membership:
        record_attempt(db, identifier_key, ip_key)
        audit(db, "login", request_id, "failure")
        db.commit()
        if identifier_blocked or ip_blocked:
            raise TooManyAttempts()
        raise AuthError()
    identity = Identity(user, membership)
    token = create_refresh(db, identity, settings)
    audit(db, "login", request_id, "success", identity)
    db.execute(delete(LoginAttempt).where(LoginAttempt.identifier_hash == identifier_key))
    db.commit()
    return identity, token


# A valid Argon2id hash prevents a non-existent account from skipping expensive verification.
_DUMMY_HASH = hash_password("not-a-real-account-password")


def create_refresh(db: Session, identity: Identity, settings: Settings,
                   family_id: uuid.UUID | None = None) -> str:
    value = new_refresh_token()
    db.add(RefreshSession(
        token_hash=token_digest(value), user_id=identity.user.id,
        organization_id=identity.membership.organization_id,
        family_id=family_id or uuid.uuid4(),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
    ))
    return value


def identity_from_token(db: Session, token: str, settings: Settings) -> Identity:
    try:
        claims = decode_access(token, settings)
        if claims["typ"] != "access" or not isinstance(claims["ver"], int):
            raise AuthError()
        user_id, org_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["org"])
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise AuthError() from None
    user = db.get(User, user_id)
    membership = db.scalar(select(Membership).where(
        Membership.user_id == user_id, Membership.organization_id == org_id,
        Membership.is_active.is_(True),
    ))
    if not user or not user.is_active or user.token_version != claims["ver"] or not membership:
        raise AuthError()
    return Identity(user, membership)


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
    if row.expires_at <= utcnow():
        raise AuthError()
    user = db.get(User, row.user_id)
    membership = db.scalar(select(Membership).where(
        Membership.user_id == row.user_id,
        Membership.organization_id == row.organization_id,
        Membership.is_active.is_(True),
    ))
    if not user or not user.is_active or not membership:
        raise AuthError()
    row.revoked_at = utcnow()
    identity = Identity(user, membership)
    new_value = create_refresh(db, identity, settings, row.family_id)
    audit(db, "refresh", request_id, "success", identity)
    db.commit()
    return identity, new_value


def logout(db: Session, value: str | None, request_id: str) -> None:
    if value:
        row = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == token_digest(value),
        ).with_for_update())
        if row and not row.revoked_at:
            row.revoked_at = utcnow()
            db.add(AuditEvent(
                action="logout", outcome="success", request_id=request_id,
                actor_id=row.user_id, organization_id=row.organization_id,
                resource_type="user", resource_id=row.user_id,
            ))
    db.commit()


def change_password(db: Session, identity: Identity, current: str, new: str,
                    request_id: str) -> None:
    user = db.scalar(select(User).where(User.id == identity.user.id).with_for_update())
    if not user or current == new or not verify_password(current, user.password_hash):
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
            identity.user.id, identity.membership.organization_id,
            identity.user.token_version, settings,
        ),
        expires_in=settings.access_token_minutes * 60,
        user=identity.public(),
    )