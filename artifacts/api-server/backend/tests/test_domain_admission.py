"""Disposable exact-host configuration, DNS fixtures and raw ASGI admission."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from app.core.config import get_settings, Settings
from app.core.host_policy import HostPolicy, exact_host
from app.core.security import utcnow
from app.db.domain_models import DomainPolicy
from app.db.models import AuditEvent
from app.services import domain_policy as policy
from app.api.v1.role_urls import domain_action
from app.schemas.role_urls import DomainAction
from test_sessions import client, create_user, login
from test_reporting import admin_headers

BASE = "/api/v1/admin/role-urls"
HOST = "portal.allergyevexia.com"


def action(api, headers, row, name):
    return api.post(BASE + "/domain-action", headers=headers, json={
        "hostname": row["hostname"], "version": row["version"], "action": name})


def primary(api, headers, hostname=HOST, previous=None, version=0):
    response = api.post(BASE + "/primary", headers=headers, json={
        "hostname": hostname, "previous_hostname": previous, "version": version})
    assert response.status_code == 200, response.text
    return response.json()


def unthrottle(db, hostname=HOST):
    row = db.get(DomainPolicy, hostname)
    row.last_checked_at = utcnow() - timedelta(minutes=1)
    db.commit()


def test_primary_dns_and_explicit_admission(client, monkeypatch):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    p = primary(api, headers)
    assert p["status"] == "unverified" and not p["active"]
    p = action(api, headers, p, "challenge").json()
    assert p["challenge_name"] == "_evexia-verification." + HOST
    assert len(p["challenge_value"]) >= 56
    assert action(api, headers, p, "verify").status_code == 429
    unthrottle(db)
    monkeypatch.setattr(policy, "lookup_txt", lambda name: [p["challenge_value"]])
    p = action(api, headers, p, "verify").json()
    assert p["status"] == "verified" and p["verified_at"] and not p["active"]
    with pytest.raises(PermissionError):
        policy.admitted(db, HOST)
    p = action(api, headers, p, "activate").json()
    assert p["active"] and policy.admitted(db, HOST) is None
    # Host query cannot select an unrelated role, including localhost bypass.
    assert api.get("/api/v1/portal/resolve", params={"hostname": HOST}).status_code == 421
    assert api.get("/api/v1/portal/resolve", headers={"Host": HOST}, params={"hostname": "localhost"}).status_code == 422
    assert api.get("/api/v1/portal/resolve", headers={"Host": HOST}, params={"hostname": HOST}).json() == {"role": None}
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_type == "domain_policy")))
    assert len(events) == 5
    assert all(e.actor_id == admin.id and e.session_id and e.request_id for e in events)
    assert p["challenge_value"] not in repr([e.__dict__ for e in events])
    p = action(api, headers, p, "revoke").json()
    assert not p["active"] and p["status"] == "revoked" and p["challenge_value"] is None
    assert action(api, headers, p, "activate").status_code == 409


@pytest.mark.parametrize("result,status", [([], "failed"), (["wrong"], "failed"), (TimeoutError(), "unavailable")])
def test_dns_failures_expiry_rotation(client, monkeypatch, result, status):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    p = action(api, headers, primary(api, headers), "challenge").json()
    token = p["challenge_value"]
    unthrottle(db)
    def lookup(name):
        assert name == "_evexia-verification." + HOST
        if isinstance(result, Exception):
            raise result
        return result
    monkeypatch.setattr(policy, "lookup_txt", lookup)
    p = action(api, headers, p, "verify").json()
    assert p["status"] == status and p["verified_at"] is None and not p["active"]
    unthrottle(db)
    rotated = action(api, headers, p, "challenge").json()
    assert rotated["challenge_value"] != token
    assert action(api, headers, p, "verify").status_code == 409
    row = db.get(DomainPolicy, HOST)
    row.challenge_expires_at = utcnow() - timedelta(seconds=1)
    row.last_checked_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert action(api, headers, rotated, "verify").status_code == 409
    assert api.get(BASE, headers=headers).json()["domains"][0]["status"] == "expired"


def test_primary_conflicts_replacement_and_legacy_attribution(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    legacy = api.post(BASE, headers=headers, json={"hostname": HOST, "role": "admin"}).json()
    response = api.post(BASE + "/primary", headers=headers, json={"hostname": HOST, "version": 0})
    assert response.status_code == 409
    assert api.get(BASE, headers=headers).json()["items"][0]["created_by"] == str(admin.id)
    assert api.get(BASE, headers=headers).json()["domains"] == []
    api.post(f"{BASE}/{legacy['id']}/edit", headers=headers,
             json={"hostname": HOST, "role": "admin", "enabled": False, "version": 1})
    p = primary(api, headers)
    assert api.post(f"{BASE}/{legacy['id']}/edit", headers=headers,
                    json={"hostname": HOST, "role": "admin", "enabled": True, "version": 2}).status_code == 409
    replacement = primary(api, headers, "new.allergyevexia.com", HOST, p["version"])
    assert replacement["version"] > p["version"] and replacement["verified_at"] is None
    assert db.get(DomainPolicy, HOST) is None
    assert api.post(BASE + "/primary", headers=headers,
                    json={"hostname": HOST, "previous_hostname": HOST, "version": p["version"]}).status_code == 409


def test_domain_permissions_and_missing_schema_fail_closed(client, monkeypatch):
    api, db, _ = client
    user = create_user(db, "domain-mr@example.com")
    headers = {"Authorization": "Bearer " + login(api, user.email).json()["access_token"]}
    for auth, expected in (({}, 401), (headers, 403)):
        assert api.post(BASE + "/primary", headers=auth, json={"hostname": HOST, "version": 0}).status_code == expected
        assert api.post(BASE + "/domain-action", headers=auth, json={
            "hostname": HOST, "version": 0, "action": "challenge"}).status_code == expected
    db.execute(text("ALTER TABLE domain_policies RENAME TO domain_policies_missing"))
    assert api.get("/api/v1/portal/resolve", params={"hostname": "unmapped.allergyevexia.com"},
                   headers={"Host": "unmapped.allergyevexia.com"}).status_code == 503
    db.rollback()


@pytest.mark.parametrize("host", ["evil.com,good.com", "good.com.", "*.good.com",
    "good.com/evil", "good.com@evil.com", " good.com", "good.com:0", "good.com:65536",
    "good.com\\evil", "-bad.com", "bad..com", "good.com\n"])
def test_raw_invalid_host(host):
    with pytest.raises(ValueError):
        exact_host(host)


def test_production_bootstrap_proxy_and_early_rejection(monkeypatch):
    settings = get_settings().model_copy(update={
        "app_env": "production", "portal_bootstrap_hosts": "recovery.allergyevexia.com"})
    seen = []
    async def endpoint(request):
        seen.append(request.headers.get("host"))
        return JSONResponse({"scheme": request.url.scheme,
                             "forwarded": request.headers.get("x-forwarded-host")})
    inner = Starlette(routes=[Route("/{path:path}", endpoint, methods=["GET", "POST"])])
    from app.core import host_policy
    class BrokenDB:
        def __enter__(self):
            raise RuntimeError("synthetic unavailable policy")
        def __exit__(self, *args):
            pass
    monkeypatch.setattr(host_policy, "session_factory", lambda: lambda: BrokenDB())
    # Recovery admission must not need DB; dynamic hosts fail closed.
    # Replace the session wrapper only for explicit bootstrap fast path below.
    boundary = HostPolicy(inner, settings)
    with TestClient(boundary, base_url="http://recovery.allergyevexia.com") as http:
        response = http.get("/api/auth", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": HOST})
        assert response.status_code == 200 and response.json() == {"scheme": "http", "forwarded": None}
        assert http.get("/", headers={"Host": "unknown.allergyevexia.com"}).status_code == 503
        assert http.get("/", headers=[("Host", HOST), ("Host", HOST)]).status_code == 400
        assert seen == ["recovery.allergyevexia.com"]
    with pytest.raises(ValueError, match="PORTAL_BOOTSTRAP_HOSTS"):
        HostPolicy(inner, settings.model_copy(update={"portal_bootstrap_hosts": ""}))
    with pytest.raises(ValueError):
        settings.model_copy(update={"trusted_proxy_peers": "*"}).proxy_peers


def test_forwarding_is_exact_peer_only():
    async def endpoint(request):
        return JSONResponse({"scheme": request.url.scheme,
                             "forwarded": request.headers.get("x-forwarded-host")})
    inner = Starlette(routes=[Route("/", endpoint)])
    settings = get_settings().model_copy(update={"trusted_proxy_peers": "127.0.0.2"})
    headers = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": HOST,
               "X-Forwarded-For": "198.51.100.1", "Forwarded": "host=" + HOST}
    with TestClient(HostPolicy(inner, settings), client=("127.0.0.1", 123)) as api:
        assert api.get("/", headers=headers).json() == {"scheme": "http", "forwarded": None}
    with TestClient(HostPolicy(inner, settings), client=("127.0.0.2", 123)) as api:
        assert api.get("/", headers=headers).json() == {"scheme": "https", "forwarded": None}
        assert api.get("/", headers={**headers, "X-Forwarded-Proto": "https,http"}).json()["scheme"] == "http"


@pytest.mark.parametrize("mutation", ["version", "delete", "expire", "rotate"])
def test_stale_dns_completion_cannot_restore_changed_evidence(client, monkeypatch, mutation):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    p = action(api, headers, primary(api, headers), "challenge").json()
    unthrottle(db)
    def lookup(name):
        row = db.get(DomainPolicy, HOST)
        if mutation == "delete":
            db.delete(row)
        elif mutation == "expire":
            row.challenge_expires_at = utcnow() - timedelta(seconds=1)
        elif mutation == "rotate":
            policy.rotate(row)
            row.version += 1
        else:
            row.version += 1
        db.commit()
        return [p["challenge_value"]]
    monkeypatch.setattr(policy, "lookup_txt", lookup)
    assert action(api, headers, p, "verify").status_code == 409
    row = db.get(DomainPolicy, HOST)
    assert not row or not row.active
    assert not row or row.verified_at is None


def test_expired_evidence_and_disabled_mapping_deny_admission(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    from test_role_urls import admit_fixture
    mapping = api.post(BASE, headers=headers, json={"hostname": HOST, "role": "mr"}).json()
    admit_fixture(db, HOST, actor)
    assert policy.admitted(db, HOST) == "mr"
    row = db.get(DomainPolicy, HOST)
    row.verification_expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    with pytest.raises(PermissionError):
        policy.admitted(db, HOST)
    assert action(api, headers, {"hostname": HOST, "version": row.version}, "activate").status_code == 409
    row.verification_expires_at = utcnow() + timedelta(days=1)
    db.commit()
    response = api.post(f"{BASE}/{mapping['id']}/edit", headers=headers, json={
        "hostname": HOST, "role": "mr", "enabled": False, "version": mapping["version"]})
    assert response.status_code == 200
    assert db.get(DomainPolicy, HOST) is None
    with pytest.raises(PermissionError):
        policy.admitted(db, HOST)


def test_production_current_host_guard_auth_and_recovery_resolution(client, monkeypatch):
    from contextlib import contextmanager
    from app.core import host_policy
    from app import main
    from app.api.v1 import role_urls
    from app.db.session import get_db
    from sqlalchemy import func
    api, db, settings = client
    headers, actor = admin_headers(api, db)
    from test_role_urls import admit_fixture
    api.post(BASE, headers=headers, json={"hostname": HOST, "role": "admin"})
    admit_fixture(db, HOST, actor)
    production = settings.model_copy(update={"app_env": "production", "portal_bootstrap_hosts": "recovery.allergyevexia.com"})
    monkeypatch.setattr(main, "get_settings", lambda: production)
    monkeypatch.setattr(role_urls, "get_settings", lambda: production)
    @contextmanager
    def existing_session():
        yield db
    monkeypatch.setattr(host_policy, "session_factory", lambda: existing_session)
    guarded = main.create_app()
    guarded.dependency_overrides[get_db] = main.app.dependency_overrides[get_db]
    guarded.dependency_overrides[get_settings] = lambda: production
    with TestClient(guarded, base_url="https://" + HOST) as http:
        assert http.get("/api/v1/portal/resolve", params={"hostname": HOST}).json() == {"role": "admin"}
        assert http.get("/api/v1/portal/resolve", params={"hostname": "localhost"}).status_code == 422
        assert http.get("/api/v1/portal/resolve", params={"hostname": "mr.allergyevexia.com"}).status_code == 421
        before = db.scalar(select(func.count()).select_from(AuditEvent))
        for host in ("evil.allergyevexia.com", HOST + ".evil.com", "unverified.allergyevexia.com"):
            assert http.post("/api/v1/auth/login", headers={"Host": host, "Origin": "https://" + host},
                             json={"identifier": "unused", "password": "unused"}).status_code == 421
        assert before == db.scalar(select(func.count()).select_from(AuditEvent))
        recovery = {"Host": "recovery.allergyevexia.com"}
        assert http.get("/api/v1/portal/resolve", params={"hostname": recovery["Host"]}, headers=recovery).json() == {"role": None}
        assert http.get("/api/v1/auth/me", headers=recovery).status_code == 401
        db.execute(text("ALTER TABLE domain_policies RENAME TO domain_policies_unavailable"))
        assert http.get("/api/v1/portal/resolve", params={"hostname": recovery["Host"]}, headers=recovery).status_code == 503
        db.rollback()


def test_dns_library_bounds_exact_name_and_payload(monkeypatch):
    from types import SimpleNamespace
    import dns.resolver
    record = SimpleNamespace(strings=[b"evexia-domain=", b"fixture"])
    class Answer(list):
        canonical_name = SimpleNamespace(to_text=lambda: "_evexia-verification." + HOST + ".")
        rrset = [record]
    answer = Answer([record])
    resolver = SimpleNamespace()
    def resolve(name, kind, **kwargs):
        assert name == "_evexia-verification." + HOST + "." and kind == "TXT"
        assert kwargs == {"search": False, "lifetime": 3, "raise_on_no_answer": False}
        return answer
    resolver.resolve = resolve
    monkeypatch.setattr(dns.resolver, "Resolver", lambda: resolver)
    assert policy.lookup_txt("_evexia-verification." + HOST) == ["evexia-domain=fixture"]
    assert resolver.timeout == 1 and resolver.lifetime == 3
    answer.rrset = [record] * 33
    with pytest.raises(RuntimeError):
        policy.lookup_txt("_evexia-verification." + HOST)
    answer.rrset = [record]
    answer.canonical_name = SimpleNamespace(to_text=lambda: "other.allergyevexia.com.")
    assert policy.lookup_txt("_evexia-verification." + HOST) == []


def test_independent_committed_dns_completion_loses_to_revocation(monkeypatch):
    """A held lookup must not retain transaction/user locks or revive a host."""
    import uuid
    from app.bootstrap import bootstrap_super_admin
    from pydantic import SecretStr
    from app.services import auth
    from app.db.session import session_factory
    from app.db.models import User
    from app.api.v1.role_urls import mutate
    from app.schemas.role_urls import RoleUrlFields
    from test_sessions import PASSWORD
    settings = get_settings()
    assert settings.app_env == "test"
    host = uuid.uuid4().hex + ".allergyevexia.com"
    with session_factory()() as db:
        actor_id = bootstrap_super_admin(db, SecretStr(PASSWORD)).user_id
        actor_user = db.get(User, actor_id)
        identity, _ = auth.login(db, actor_user.email, PASSWORD, settings, False, "domain-race", "127.0.0.1")
        token = auth.token_response(identity, settings).access_token
        actor = auth.identity_from_token(db, token, settings)
        mutate(db, actor, RoleUrlFields(hostname=host, role="mr"))
        p = domain_action(DomainAction(hostname=host, version=0, action="challenge"), actor, db)
        db.get(DomainPolicy, host).last_checked_at = utcnow() - timedelta(minutes=1)
        db.commit()
    entered, release = Event(), Event()
    def lookup(name):
        assert name == "_evexia-verification." + host
        entered.set()
        assert release.wait(10)
        return [p["challenge_value"]]
    monkeypatch.setattr(policy, "lookup_txt", lookup)
    def verify():
        with session_factory()() as db:
            actor = auth.identity_from_token(db, token, settings)
            try:
                domain_action(DomainAction(hostname=host, version=p["version"], action="verify"), actor, db)
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(verify)
        try:
            assert entered.wait(10)
            with session_factory()() as db:
                actor = auth.identity_from_token(db, token, settings)
                row = db.get(DomainPolicy, host)
                revoked = domain_action(DomainAction(hostname=host, version=row.version, action="revoke"), actor, db)
                assert revoked["status"] == "revoked"
        finally:
            release.set()
        assert future.result(timeout=10) == 409
    with session_factory()() as db:
        row = db.get(DomainPolicy, host)
        assert row.status == "revoked" and not row.active and row.verified_at is None


def test_current_head_keeps_reviewed_crypto_inventory(client):
    from app.services import directory_rotation
    from app.services.directory_inventory import RUNTIME_FIELDS
    _, db, _ = client
    assert directory_rotation._fields(db) == RUNTIME_FIELDS
    assert "0037_domain_admission" in directory_rotation.SUPPORTED_REVISIONS
    assert "0041_location_geography" in directory_rotation.SUPPORTED_REVISIONS
    assert "0042_unreviewed" not in directory_rotation.SUPPORTED_REVISIONS
    db.rollback()
    try:
        directory_rotation._lock(db)
        assert db.scalar(text("""SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid()
            AND relation=to_regclass('vendors') AND mode='ShareLock' AND granted)"""))
    finally:
        db.rollback()
