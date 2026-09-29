import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.db.models import AuditEvent, Membership
from app.db.session import get_db, session_factory
from app.main import app
from app.services.auth import AuthError, identity_from_token


@pytest.fixture
def client():
    # Application commits use SAVEPOINTs; the outer transaction rolls back all test data.
    connection = session_factory().kw["bind"].connect()
    outer = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    settings = get_settings().model_copy(update={"allow_public_registration": True})

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


def register(client, email="sample@example.com"):
    response = client.post(
        "/api/v1/auth/register", headers={"Origin": "http://testserver"},
        json={"email": email, "username": email.split("@")[0], "password": "correct horse battery staple",
              "organization_name": "Example Organization"},
    )
    assert response.status_code == 201, response.text
    return response


def test_health_and_unauthorized(client):
    api, _, _ = client
    assert api.get("/api/v1/health").json() == {"status": "ok"}
    assert api.get("/api/v1/version").json() == {"api": "v1"}
    assert api.get("/api/v1/health/readiness").status_code == 200
    assert api.get("/api/healthz").status_code == 200
    assert api.get("/api/v1/auth/me").status_code == 401
    assert api.post("/api/v1/auth/refresh").status_code == 403  # Origin required


def test_auth_lifecycle_and_token_reuse(client):
    api, db, settings = client
    response = register(api)
    body = response.json()
    access = body["access_token"]
    assert body["user"]["role"] == "owner"
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 200
    assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                    json={"identifier": "sample", "password": "wrong"}).status_code == 401
    assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                    json={"identifier": "sample", "password": "correct horse battery staple"}).status_code == 200
    old_refresh = api.cookies.get("evexia_refresh")
    renewed = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert renewed.status_code == 200
    assert api.cookies.get("evexia_refresh") != old_refresh
    # Reusing an old token revokes the entire refresh-token family.
    api.cookies.set("evexia_refresh", old_refresh, path="/api/v1/auth")
    assert api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"}).status_code == 401
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "refresh_reuse")) is not None
    # Access tokens remain short-lived; password changes explicitly revoke all of them.
    password = api.post(
        "/api/v1/auth/change-password", headers={"Authorization": f"Bearer {access}"},
        json={"current_password": "correct horse battery staple", "new_password": "another long secure password"},
    )
    assert password.status_code == 204
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401
    assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                    json={"identifier": "sample@example.com", "password": "another long secure password"}).status_code == 200


def test_tenant_claim_and_membership_checked_against_database(client):
    api, db, settings = client
    first = register(api, "one@example.com").json()
    second = register(api, "two@example.com").json()
    first_identity = first["user"]
    other_org = second["user"]["organization_id"]
    from app.core.security import access_token
    forged_org = access_token(uuid.UUID(first_identity["id"]), uuid.UUID(other_org), 0, settings)
    with pytest.raises(AuthError):
        identity_from_token(db, forged_org, settings)
    identity = identity_from_token(db, first["access_token"], settings)
    assert require_roles("owner")(identity) == identity
    identity.membership.role = "viewer"
    with pytest.raises(HTTPException) as forbidden:
        require_roles("owner")(identity)
    assert forbidden.value.status_code == 403
    membership = db.scalar(select(Membership).where(Membership.user_id == identity.user.id))
    membership.is_active = False
    db.flush()
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {first['access_token']}"}).status_code == 401


def test_rate_limit_and_safe_errors(client):
    api, db, settings = client
    absent = f"absent-{uuid.uuid4().hex[:12]}@example.com"
    for _ in range(5):
        assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                        json={"identifier": absent, "password": "wrong"}).status_code == 401
    blocked = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                       json={"identifier": absent, "password": "wrong"})
    assert blocked.status_code == 429
    assert "password" not in blocked.text
    malformed = api.post("/api/v1/auth/register", headers={"Origin": "http://testserver"},
                         json={"email": "not-email", "password": "private example password"})
    assert malformed.status_code == 422
    assert "private example password" not in malformed.text


def test_duplicate_username_is_a_controlled_registration_error(client):
    api, _, _ = client
    register(api, "first@example.com")
    duplicate = api.post(
        "/api/v1/auth/register", headers={"Origin": "http://testserver"},
        json={"email": "another@example.com", "username": "first",
              "password": "correct horse battery staple", "organization_name": "Another"},
    )
    assert duplicate.status_code == 403
    assert "traceback" not in duplicate.text.lower()


def test_valid_password_can_sign_in_after_failed_attempts(client):
    api, _, _ = client
    register(api, "real@example.com")
    for _ in range(6):
        api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                 json={"identifier": "real", "password": "wrong"})
    valid = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                     json={"identifier": "real", "password": "correct horse battery staple"})
    assert valid.status_code == 200