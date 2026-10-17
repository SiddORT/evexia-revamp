"""Version-bound, purpose-separated recovery; existing user locks provide one use."""
import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import timedelta

import jwt
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select, text

from app.core.security import hash_password, utcnow, verify_password
from app.db.models import User
from app.repositories import sessions
from app.services import account_crypto, auth, recovery_mail, email_templates
from app.services.email_rendering import render_recovery
from app.services.staff_crypto import StaffCrypto

MESSAGE = "If an eligible account matches, we will attempt to send a password-recovery email."
INVALID = "This recovery link is invalid, expired or already used. Request a new link."
logger = logging.getLogger(__name__)


def _key(settings):
    return hmac.new(settings.signing_key.encode(),
                    b"evexia:password-recovery:signing:v1", hashlib.sha256).digest()


def _recipient(identity, settings):
    value = identity.user.email
    if value is None and identity.staff is not None:
        value = StaffCrypto(settings).decrypt(identity.staff.id, "email",
                                              identity.staff.email_ciphertext)
    try:
        return str(TypeAdapter(EmailStr).validate_python(value))
    except Exception:
        raise auth.AuthError() from None


def _binding(settings, address):
    return hmac.new(_key(settings), b"recipient:v1:" + address.lower().encode(),
                    hashlib.sha256).hexdigest()


def _kind(identity):
    return "mr" if identity.mr is not None else "admin"


def _eligible(identity):
    # Portal intent is not authority: Admin sign-in serves staff AND Super Admin.
    # Recheck persisted identity at consumption so pre-policy links also fail.
    return (not identity.user.is_protected_system_admin
            and identity.user.system_role != "super_admin"
            and (identity.staff is not None or identity.mr is not None))


def rate_limit(db, settings, scope, values, maximum):
    keys = sorted(auth._limit_key(settings, "recovery:" + scope, value) for value in values)
    # Serialize count+insert; simultaneous requests cannot evade the limit.
    for key in keys:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": key})
    allowed = all(not auth.limit_state(db, settings, "recovery:" + scope, value, maximum)[1]
                  for value in values)
    auth.record_attempt(db, *keys)
    db.commit()
    return allowed


def issue_and_send(db, settings, identifier, identity_kind):
    """Run after the generic response, so SMTP/account timing cannot enumerate."""
    user = db.scalar(select(User).where(account_crypto.lookup(db, identifier)))
    if not user:
        return
    try:
        identity = auth._load_identity(db, user)
        if not _eligible(identity) or _kind(identity) != identity_kind:
            return
        recipient = _recipient(identity, settings)
    except auth.AuthError:
        return
    now = utcnow()
    claims = {
        "sub": str(user.id), "ver": user.token_version, "iver": user.identity_version,
        "kind": identity_kind, "recipient": _binding(settings, recipient),
        "purpose": "password_recovery", "jti": secrets.token_urlsafe(32),
        "iat": now, "nbf": now, "exp": now + timedelta(minutes=15),
        "iss": settings.jwt_issuer, "aud": settings.jwt_audience + ":password-recovery",
    }
    token = jwt.encode(claims, _key(settings), algorithm="HS256")
    template = email_templates.resolve_recovery(db)
    # Neutral greeting avoids decrypting extra directory fields just for email.
    rendered = render_recovery(template, recipient_name="there",
                               reset_url=settings.password_recovery_url.rstrip("/") + "#token=" + token,
                               expiry_minutes=15)
    # Release read transactions before potentially slow network delivery.
    db.rollback()
    recovery_mail.send(settings, recipient, rendered)


def deliver(bind, settings, identifier, identity_kind):
    from sqlalchemy.orm import Session
    try:
        with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
            issue_and_send(db, settings, identifier, identity_kind)
    except Exception:
        # No exception text/traceback: SMTP exceptions can contain PII.
        logger.error("Password recovery delivery failed; operator investigation required.")


def reset(db, settings, token, new_password, request_id):
    try:
        claims = jwt.decode(
            token, _key(settings), algorithms=["HS256"], issuer=settings.jwt_issuer,
            audience=settings.jwt_audience + ":password-recovery",
            options={"require": ["sub", "ver", "iver", "kind", "recipient", "purpose",
                                 "jti", "iat", "nbf", "exp"]},
        )
        if (claims["purpose"] != "password_recovery" or claims["kind"] not in ("admin", "mr")
                or type(claims["ver"]) is not int or type(claims["iver"]) is not int
                or not isinstance(claims["recipient"], str)
                or not isinstance(claims["jti"], str) or len(claims["jti"]) != 43):
            raise ValueError()
        user_id = uuid.UUID(claims["sub"])
    except Exception:
        raise auth.AuthError(INVALID) from None
    account_crypto.ready(db)
    user = sessions.lock_user(db, user_id)
    if (not user or user.token_version != claims["ver"]
            or user.identity_version != claims["iver"]
            or claims["exp"] <= utcnow().timestamp()):
        raise auth.AuthError(INVALID)
    try:
        identity = auth._load_identity(db, user, lock=True)
        if (not _eligible(identity) or _kind(identity) != claims["kind"]
                or not hmac.compare_digest(claims["recipient"],
                                           _binding(settings, _recipient(identity, settings)))):
            raise auth.AuthError()
    except auth.AuthError:
        raise auth.AuthError(INVALID) from None
    if verify_password(new_password, user.password_hash):
        raise auth.AuthError("Choose a password different from your current password.")
    user.password_hash = hash_password(new_password)
    user.token_version += 1
    sessions.revoke_user_sessions(db, user.id, "password_change", request_id)
    auth.audit(db, "password_reset", request_id, "success", identity)
    # Password, token consumption, audit and session revocations are atomic.
    db.commit()
    return claims["kind"]
