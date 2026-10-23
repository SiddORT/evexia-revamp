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
from app.services import account_crypto, auth, recovery_mail, email_templates, email_delivery
from app.services.email_rendering import render_recovery
from app.services.staff_crypto import StaffCrypto

MESSAGE = "If an eligible account matches, we will attempt to send a password-recovery email."
INVALID = "This recovery link is invalid, expired or already used. Request a new link."
logger = logging.getLogger(__name__)


def _key(settings, purpose="password_recovery"):
    return hmac.new(settings.signing_key.encode(),
                    (b"evexia:password-recovery:signing:v1" if purpose == "password_recovery"
                     else b"evexia:account-invitation:signing:v1"), hashlib.sha256).digest()


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
        identity = auth._load_identity(db, user, allow_password_setup=True)
        if not _eligible(identity) or _kind(identity) != identity_kind:
            return
        recipient = _recipient(identity, settings)
    except auth.AuthError:
        return
    attempt_id = email_delivery.record(db, settings, "password_recovery", identity_kind,
                                       user_id=user.id, recipient=recipient)
    try:
        send_identity(db, settings, identity, recipient, "password_recovery", attempt_id)
    except Exception:
        email_delivery.preparation_interrupted(db, attempt_id)


def send_identity(db, settings, identity, recipient, purpose, attempt_id):
    # Validate before building the signed link. SMTP test messages do not need
    # an action URL, but invitations and password recovery always do.
    try:
        recovery_mail.validate_link_configuration(settings)
    except recovery_mail.RecoveryUnavailable:
        email_delivery.outcome(db, attempt_id, "failed", "configuration")
        return
    user = identity.user
    identity_kind = _kind(identity)
    now = utcnow()
    claims = {
        "sub": str(user.id), "ver": user.token_version, "iver": user.identity_version,
        "kind": identity_kind, "recipient": _binding(settings, recipient),
        "purpose": purpose, "jti": secrets.token_urlsafe(32),
        "correlation": str(attempt_id),
        "iat": now, "nbf": now, "exp": now + timedelta(minutes=15),
        "iss": settings.jwt_issuer, "aud": settings.jwt_audience + ":" + purpose.replace("_", "-"),
    }
    token = jwt.encode(claims, _key(settings, purpose), algorithm="HS256")
    # Fragment is removed immediately by the public page; portal/purpose are
    # non-secret hints only. Signed claims are the authority.
    login_id = user.username
    suffix = "" if purpose == "password_recovery" else "?invitation=1&portal=" + identity_kind
    url = settings.password_recovery_url.rstrip("/") + suffix + "#token=" + token
    email_delivery.dispatch(db, settings, attempt_id, recipient, lambda template:
        render_recovery(template, recipient_name="there", reset_url=url,
                        expiry_minutes=15, portal_name="MR portal" if identity_kind == "mr" else "Admin workspace",
                        login_id=login_id),
        event=("mr_invitation" if identity.mr is not None else "account_invitation")
              if purpose == "account_invitation" else "password_recovery")


def deliver(bind, settings, identifier, identity_kind):
    from sqlalchemy.orm import Session
    try:
        with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
            issue_and_send(db, settings, identifier, identity_kind)
    except Exception:
        # No exception text/traceback: SMTP exceptions can contain PII.
        logger.error("Password recovery delivery failed; operator investigation required.")


def reset(db, settings, token, new_password, request_id, purpose="password_recovery"):
    try:
        claims = jwt.decode(
            token, _key(settings, purpose), algorithms=["HS256"], issuer=settings.jwt_issuer,
            audience=settings.jwt_audience + ":" + purpose.replace("_", "-"),
            options={"require": ["sub", "ver", "iver", "kind", "recipient", "purpose",
                                 "jti", "iat", "nbf", "exp"]},
        )
        if (claims["purpose"] != purpose or claims["kind"] not in ("admin", "mr")
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
        identity = auth._load_identity(db, user, lock=True, allow_password_setup=True)
        if (not _eligible(identity) or _kind(identity) != claims["kind"]
                or not hmac.compare_digest(claims["recipient"],
                                           _binding(settings, _recipient(identity, settings)))):
            raise auth.AuthError()
        if purpose == "account_invitation":
            if identity.staff is not None and identity.staff.custom_role_id is None:
                raise auth.AuthError()
            if identity.mr is not None:
                from app.db.mr_models import MRDirectory
                directory = db.get(MRDirectory, identity.mr.id, populate_existing=True, with_for_update=True)
                if not directory or directory.deleted_at is not None or directory.status != "active":
                    raise auth.AuthError()
    except auth.AuthError:
        raise auth.AuthError(INVALID) from None
    if verify_password(new_password, user.password_hash):
        raise auth.AuthError("Choose a password different from your current password.")
    user.password_hash = hash_password(new_password)
    user.password_setup_required = False
    user.token_version += 1
    sessions.revoke_user_sessions(db, user.id, "password_change", request_id)
    auth.audit(db, "invitation_password_setup" if purpose == "account_invitation" else "password_reset",
               request_id, "success", identity)
    # Signed non-secret correlation, never the token or recipient.
    from app.db.models import AuditEvent
    if claims.get("correlation"):
        try:
            correlation_id = uuid.UUID(claims["correlation"])
        except (ValueError, TypeError):
            raise auth.AuthError(INVALID) from None
        db.add(AuditEvent(actor_id=user.id, action="email_password_setup",
                          resource_type="email_attempt", resource_id=correlation_id,
                          outcome="success", request_id=request_id))
    # Password, token consumption, audit and session revocations are atomic.
    db.commit()
    return claims["kind"]
