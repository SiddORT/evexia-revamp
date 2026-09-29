import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher, exceptions

from app.core.config import Settings

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return hasher.verify(encoded, password)
    except (exceptions.VerifyMismatchError, exceptions.VerificationError, exceptions.InvalidHashError):
        return False


def access_token(user_id: uuid.UUID, org_id: uuid.UUID, version: int, settings: Settings) -> str:
    now = utcnow()
    claims = {
        "sub": str(user_id), "org": str(org_id), "ver": version, "typ": "access",
        "jti": str(uuid.uuid4()), "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "iss": settings.jwt_issuer, "aud": settings.jwt_audience,
    }
    return jwt.encode(claims, settings.signing_key, algorithm="HS256")


def decode_access(token: str, settings: Settings) -> dict:
    return jwt.decode(
        token, settings.signing_key, algorithms=["HS256"],
        issuer=settings.jwt_issuer, audience=settings.jwt_audience,
        options={"require": ["sub", "org", "ver", "typ", "jti", "iat", "exp", "iss", "aud"]},
        leeway=5,
    )


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()