import uuid

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AuditEvent, MRProfile, RefreshSession, User
from app.db.session import get_db, session_factory
from app.main import app
from app.services.auth import AuthError, identity_from_token, revalidate_identity

PASSWORD = "correct horse battery staple"


@pytest.fixture
def client():
    # Application commits use SAVEPOINTs; the outer transaction rolls back all test data.
    if get_settings().app_env == "production":
        pytest.fail("Authentication tests refuse to connect with APP_ENV=production")
    connection = session_factory().kw["bind"].connect()
    outer = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    settings = get_settings()

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app, base_url="http://testserver") as test_client:
            yield test_client, db, settings
    finally:
        app.dependency_overrides.clear()
        db.close()
        outer.rollback()
        connection.close()


def create_user(db, email, role="mr", password=PASSWORD):
    user = User(
        email=email, username=email.split("@")[0], password_hash=hash_password(password),
        system_role=role, identity_version=1 if role else 0,
    )
    db.add(user)
    db.flush()
    profile = None
    if role == "mr":
        profile = MRProfile(user_id=user.id, is_active=True)
        db.add(profile)
        db.flush()
    db.commit()
    return user, profile


def login(api, identifier, password=PASSWORD):
    return api.post(
        "/api/v1/auth/login", headers={"Origin": "http://testserver"},
        json={"identifier": identifier, "password": password},
    )


def test_health_and_unauthorized(client):
    api, _, _ = client
    assert api.get("/api/v1/health").json() == {"status": "ok"}
    assert api.get("/api/v1/version").json() == {"api": "v1"}
    assert api.get("/api/v1/health/readiness").status_code == 200
    assert api.get("/api/healthz").status_code == 200
    assert api.get("/api/v1/auth/me").status_code == 401
    assert api.post("/api/v1/auth/refresh").status_code == 403
    assert api.post("/api/v1/auth/register", headers={"Origin": "http://testserver"}).status_code == 403


def test_auth_lifecycle_refresh_reuse_and_password_revocation(client):
    api, db, _ = client
    create_user(db, "sample@example.com")
    response = login(api, "sample")
    assert response.status_code == 200, response.text
    body = response.json()
    access = body["access_token"]
    assert body["user"]["system_role"] == "mr"
    assert body["user"]["mr_id"]
    assert "organization_id" not in body["user"]
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 200

    assert login(api, "sample", "wrong").status_code == 401
    assert login(api, "sample").status_code == 200
    old_refresh = api.cookies.get("evexia_refresh")
    renewed = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert renewed.status_code == 200
    assert api.cookies.get("evexia_refresh") != old_refresh

    api.cookies.set("evexia_refresh", old_refresh, path="/api/v1/auth")
    assert api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"}).status_code == 401
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "refresh_reuse")) is not None

    password = api.post(
        "/api/v1/auth/change-password", headers={"Authorization": f"Bearer {access}"},
        json={"current_password": PASSWORD, "new_password": "another long secure password"},
    )
    assert password.status_code == 204
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401
    assert login(api, "sample@example.com", "another long secure password").status_code == 200
    assert db.scalar(select(RefreshSession).where(RefreshSession.organization_id.is_not(None))) is None


def test_unmapped_legacy_user_and_legacy_org_token_are_rejected(client):
    api, db, settings = client
    user, _ = create_user(db, "legacy@example.com", role=None)
    # Correct password is not enough: old organization roles are never elevated implicitly.
    assert login(api, user.email).status_code == 401
    legacy = jwt.encode(
        {
            "sub": str(user.id), "org": str(uuid.uuid4()), "ver": user.token_version,
            "typ": "access", "jti": str(uuid.uuid4()), "iat": 1, "exp": 4_000_000_000,
            "iss": settings.jwt_issuer, "aud": settings.jwt_audience,
        },
        settings.signing_key, algorithm="HS256",
    )
    with pytest.raises(AuthError):
        identity_from_token(db, legacy, settings)
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {legacy}"}).status_code == 401


def test_identity_version_and_mr_activation_checked_on_each_token_use(client):
    api, db, settings = client
    user, mr = create_user(db, "versioned@example.com")
    token = login(api, user.email).json()["access_token"]
    identity = identity_from_token(db, token, settings)
    assert identity.mr.id == mr.id
    assert require_roles("mr")(identity) == identity
    with pytest.raises(HTTPException) as denied:
        require_roles("super_admin")(identity)
    assert denied.value.status_code == 403

    user.identity_version += 1
    db.flush()
    with pytest.raises(AuthError):
        identity_from_token(db, token, settings)
    # New tokens still reject a profile disabled since user mapping.
    user.identity_version += 1
    mr.is_active = False
    db.flush()
    from app.core.security import access_token
    token_after_mapping_change = access_token(user.id, user.token_version, user.identity_version, settings)
    with pytest.raises(AuthError):
        identity_from_token(db, token_after_mapping_change, settings)


def test_superadmin_identity_and_revalidation_interface(client):
    api, db, settings = client
    user, _ = create_user(db, "root-identity@example.com", role="super_admin")
    response = login(api, user.email)
    assert response.status_code == 200
    assert response.json()["user"]["system_role"] == "super_admin"
    identity = identity_from_token(db, response.json()["access_token"], settings)
    assert revalidate_identity(db, identity, lock=False).role == "super_admin"
    user.identity_version += 1
    db.flush()
    with pytest.raises(AuthError):
        revalidate_identity(db, identity, lock=False)


def test_rate_limit_and_safe_errors(client):
    api, _, _ = client
    absent = f"absent-{uuid.uuid4().hex[:12]}@example.com"
    for _ in range(5):
        assert login(api, absent, "wrong").status_code == 401
    blocked = login(api, absent, "wrong")
    assert blocked.status_code == 429
    assert "password" not in blocked.text
    malformed = api.post(
        "/api/v1/auth/login", headers={"Origin": "http://testserver"},
        json={"identifier": "x", "password": "private example password"},
    )
    assert malformed.status_code == 422
    assert "private example password" not in malformed.text


def test_valid_password_can_sign_in_after_failed_attempts(client):
    api, db, _ = client
    create_user(db, "real@example.com")
    for _ in range(6):
        login(api, "real", "wrong")
    assert login(api, "real", PASSWORD).status_code == 200