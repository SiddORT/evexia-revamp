"""Exact host routing is centrally stored, never an authorization mechanism."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import AuditEvent, User, AuthSession
from app.db.role_url_models import RoleHostname
from app.schemas.role_urls import canonical_hostname, RoleUrlEdit, RoleUrlFields
from app.api.v1.role_urls import mutate
from app.services.auth import identity_from_token
from app.db.session import session_factory
from app.core.config import get_settings
from app.core.security import hash_password
from test_sessions import client, create_user, login, PASSWORD
from test_reporting import admin_headers

BASE = "/api/v1/admin/role-urls"
RESOLVE = "/api/v1/portal/resolve"


@pytest.mark.parametrize("raw,expected", [
    (" MR.AllergyEvexia.com ", "mr.allergyevexia.com"),
    ("https://MR.AllergyEvexia.com/", "mr.allergyevexia.com"),
    ("mr.allergyevexia.com.", "mr.allergyevexia.com"),
    ("https://xn--bcher-kva.de", "xn--bcher-kva.de"),
])
def test_normalization(raw, expected):
    assert canonical_hostname(raw) == expected


@pytest.mark.parametrize("host", [
    "http://mr.allergyevexia.com", "https://user:password@mr.allergyevexia.com",
    "https://mr.allergyevexia.com/a", "https://mr.allergyevexia.com?x=1",
    "https://mr.allergyevexia.com#", "https://mr.allergyevexia.com:443",
    "*.allergyevexia.com", "localhost", "127.0.0.1", "a.test", "a.local",
    "a..com", "-a.com", "a_.com", "a.com/path", "a.com?x", "bücher.de",
    "https://a.com\\evil", "https://a.com:bad", "//a.com", "a" * 64 + ".com",
])
def test_invalid_production_hosts(host):
    with pytest.raises(ValueError):
        canonical_hostname(host)


def test_crud_persistence_minimal_resolver_and_attribution(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json() == {"items": []}
    row = api.post(BASE, headers=headers, json={"hostname": "https://MR.AllergyEvexia.com/", "role": "mr"}).json()
    assert row["hostname"] == "mr.allergyevexia.com" and row["version"] == 1
    assert row["created_by"] == str(admin.id) == row["updated_by"]
    assert api.get(BASE, headers=headers).json()["items"] == [row]
    for params in ({"hostname": row["hostname"]}, {"hostname": row["hostname"].upper()}):
        resolved = api.get(RESOLVE, params=params, headers={"X-Forwarded-Host": "doctor.allergyevexia.com"})
        assert resolved.json() == {"role": "mr"}
        assert resolved.headers["cache-control"] == "no-store"
    for host in ("other.allergyevexia.com", "localhost", "127.0.0.1"):
        assert api.get(RESOLVE, params={"hostname": host}).json() == {"role": None}
    assert api.get(RESOLVE, params={"hostname": "https://mr.allergyevexia.com"}).status_code == 422
    assert api.post(BASE, headers=headers, json={"hostname": row["hostname"], "role": "doctor"}).status_code == 409
    edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                      json={"hostname": row["hostname"], "role": "doctor", "enabled": False, "version": 1})
    assert edited.status_code == 200 and edited.json()["version"] == 2
    assert api.get(RESOLVE, params={"hostname": row["hostname"]}).json() == {"role": None}
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"hostname": row["hostname"], "role": "admin", "version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"version": 2}).status_code == 200
    assert api.get(BASE, headers=headers).json() == {"items": []}
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_type == "role_hostname").order_by(AuditEvent.created_at)))
    assert len(events) == 3
    assert all(e.actor_id == admin.id and e.session_id and e.request_id for e in events)


def test_management_rejects_mr_staff_and_missing_identity(client):
    api, db, _ = client
    from test_staff import admin_headers as staff_admin_headers, BODY
    admin, _ = staff_admin_headers(api, db)
    created = api.post("/api/v1/admin/staff", headers=admin, json=BODY).json()
    staff = created["record"]
    enabled = api.post(f"/api/v1/admin/staff/{staff['id']}/access", headers=admin,
                       json={"custom_role_id": None, "workspace_login_enabled": True, "expected_version": staff["version"]})
    assert enabled.status_code == 200, enabled.text
    staff_login = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                           json={"identifier": staff["userId"], "password": created["initial_password"], "identity_kind": "admin"})
    assert staff_login.status_code == 200, staff_login.text
    mr = create_user(db, "host-mr@example.com")
    for response in (staff_login, login(api, mr.email)):
        headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
        assert api.get(BASE, headers=headers).status_code == 403
        assert api.post(BASE, headers=headers, json={"hostname": "mr.allergyevexia.com", "role": "mr"}).status_code == 403
        for action in ("edit", "delete"):
            assert api.post(f"{BASE}/{uuid.uuid4()}/{action}", headers=headers,
                            json={"version": 1, **({"hostname": "mr.allergyevexia.com", "role": "mr"} if action == "edit" else {})}).status_code == 403
    assert api.get(BASE).status_code == 401
    assert api.post(BASE, json={"hostname": "mr.allergyevexia.com", "role": "mr"}).status_code == 401


def test_strict_fields_and_revoked_actor(client):
    api, db, settings = client
    headers, admin = admin_headers(api, db)
    for extra in ({"role": "patient"}, {"enabled": "true"}, {"version": 1}, {"redirect": "https://evil.com"}):
        assert api.post(BASE, headers=headers, json={"hostname": "mr.allergyevexia.com", "role": "mr", **extra}).status_code == 422
    actor = identity_from_token(db, headers["Authorization"][7:], settings)
    admin.token_version += 1
    db.commit()
    from app.services.auth import AuthError
    with pytest.raises(AuthError):
        mutate(db, actor, RoleUrlFields(hostname="mr.allergyevexia.com", role="mr"))
    assert list(db.scalars(select(RoleHostname))) == []


def test_concurrent_writes_on_independent_committed_connections():
    settings = get_settings()
    assert settings.app_env == "test"
    from app.services import auth
    user_id = uuid.uuid4()
    with session_factory()() as db:
        from app.bootstrap import bootstrap_super_admin
        from pydantic import SecretStr
        result = bootstrap_super_admin(db, SecretStr(PASSWORD))
        user = db.get(User, result.user_id)
        identity, _ = auth.login(db, user.email, PASSWORD, settings, False, "host-race-setup", "127.0.0.1")
        access = auth.token_response(identity, settings)
        actor = identity_from_token(db, access.access_token, settings)
        row = mutate(db, actor, RoleUrlFields(hostname=f"{user_id.hex}.allergyevexia.com", role="mr"))
    barrier = Barrier(2)
    def write(role):
        with session_factory()() as db:
            actor = identity_from_token(db, access.access_token, settings)
            barrier.wait(timeout=10)
            try:
                return mutate(db, actor, RoleUrlEdit(hostname=row.hostname, role=role, version=1), row.id).version
            except HTTPException as exc:
                return exc.status_code
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(write, ("admin", "doctor")))
        assert sorted(outcomes) == [2, 409]
        with session_factory()() as db:
            assert db.get(RoleHostname, row.id).version == 2
    finally:
        # Leave disposable audit/session history intact; database is removed by harness.
        pass


@pytest.mark.parametrize("role,hostname", [("admin", "admin.allergyevexia.com"), ("mr", "mr.allergyevexia.com")])
def test_production_same_origin_login_renew_logout_and_cookie_boundary(client, role, hostname):
    api, db, settings = client
    headers, admin = admin_headers(api, db)
    row = api.post(BASE, headers=headers, json={"hostname": hostname, "role": role})
    assert row.status_code == 201
    user = admin if role == "admin" else create_user(db, f"host-production-{role}@example.com")
    from app.main import app
    from app.core.config import get_settings
    from fastapi.testclient import TestClient
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(update={"app_env": "production"})
    with TestClient(app, base_url=f"https://{hostname}") as host:
        origin = {"Origin": f"https://{hostname}"}
        assert host.get(RESOLVE, params={"hostname": hostname}).json() == {"role": role}
        response = host.post("/api/v1/auth/login", headers=origin,
                             json={"identifier": user.email, "password": PASSWORD, "identity_kind": role})
        assert response.status_code == 200, response.text
        cookie = response.headers["set-cookie"].lower()
        assert "__host-evexia_refresh=" in cookie
        assert all(flag in cookie for flag in ("secure", "httponly", "samesite=strict", "path=/"))
        assert "domain=" not in cookie
        access = {"Authorization": f"Bearer {response.json()['access_token']}"}
        assert host.get("/api/v1/auth/me", headers=access).json()["identity_kind"] == ("super_admin" if role == "admin" else "mr")
        renewed = host.post("/api/v1/auth/refresh", headers=origin, json={})
        assert renewed.status_code == 200
        assert host.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.com"}, json={}).status_code == 403
        assert host.post("/api/v1/auth/logout", headers=origin, json={}).status_code == 204
        assert host.post("/api/v1/auth/refresh", headers=origin, json={}).status_code == 401
        assert host.get("/api/v1/auth/me", headers=access).status_code == 401
