"""Real authentication/SMTP-boundary tests; disposable PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import threading
import uuid

import jwt
import pytest
from pydantic import SecretStr
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow, verify_password
from app.db.models import AuditEvent, User
from app.db.session import session_factory
from app.main import app
from app.services import auth, password_recovery as recovery, recovery_mail
from test_api import client, create_user, login, PASSWORD

HEADERS = {"Origin": "http://testserver"}
NEW = "new fictional password 12345"


@pytest.fixture
def configured(client, monkeypatch):
    api, db, settings = client
    settings = settings.model_copy(update={
        "password_recovery_url": "https://portal.example.com/reset-password",
        "smtp_host": "smtp.example.com", "smtp_from": "support@example.com",
    })
    app.dependency_overrides[get_settings] = lambda: settings
    sent = []
    monkeypatch.setattr(recovery_mail, "send", lambda _settings, email, token: sent.append((email, token)))
    return api, db, settings, sent


def request(api, identifier="person@example.com", kind="mr"):
    return api.post("/api/v1/auth/forgot-password", headers=HEADERS,
                    json={"identifier": identifier, "identity_kind": kind})


def reset(api, token, password=NEW):
    return api.post("/api/v1/auth/reset-password", headers=HEADERS,
                    json={"token": token, "new_password": password})


def test_generic_response_unknown_disabled_wrong_portal_and_missing_email(configured):
    api, db, _, sent = configured
    user, profile = create_user(db, "person@example.com")
    known = request(api)
    assert known.status_code == 202 and known.headers["cache-control"] == "no-store"
    assert len(sent) == 1
    for identifier, kind in [("unknown@example.com", "mr"), ("person@example.com", "admin")]:
        response = request(api, identifier, kind)
        assert response.status_code == known.status_code and response.json() == known.json()
    profile.is_active = False
    db.commit()
    assert request(api).json() == known.json()
    assert len(sent) == 1
    profile.is_active = True
    user.email = None
    db.commit()
    assert request(api, "person").json() == known.json()
    assert len(sent) == 1


def test_reset_consumes_all_links_preserves_identifiers_revokes_auth(configured):
    api, db, settings, sent = configured
    user, _ = create_user(db, "person@example.com")
    before = (user.id, user.email, user.username, user.identity_version)
    logged = login(api, "person").json()
    cookie = api.cookies.get("evexia_refresh")
    request(api, "PERSON@EXAMPLE.COM")
    request(api, "person")
    first, second = sent[0][1], sent[1][1]
    result = reset(api, first)
    assert result.status_code == 200, result.text
    assert result.json()["identity_kind"] == "mr"
    assert api.cookies.get("evexia_refresh") is None
    assert reset(api, first).status_code == reset(api, second).status_code == 400
    db.expire_all()
    user = db.get(User, before[0])
    assert (user.id, user.email, user.username, user.identity_version) == before
    assert verify_password(NEW, user.password_hash)
    assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "password_reset")) is not None
    with pytest.raises(auth.AuthError):
        auth.identity_from_token(db, logged["access_token"], settings)
    with pytest.raises(auth.AuthError):
        auth.rotate_refresh(db, cookie, settings, "synthetic-recovery")
    assert login(api, "person").status_code == 401
    assert api.post("/api/v1/auth/login", headers=HEADERS,
                    json={"identifier": "person", "password": NEW}).status_code == 200
    assert api.post("/api/v1/auth/register", headers=HEADERS).status_code == 403
    assert "person@example.com" not in first


@pytest.mark.parametrize("problem", ["expired", "access_token", "tampered", "recipient", "version", "disabled"])
def test_invalid_link_never_changes_password(configured, problem):
    api, db, settings, sent = configured
    user, profile = create_user(db, "person@example.com")
    original = user.password_hash
    request(api)
    token = sent[0][1]
    claims = jwt.decode(token, options={"verify_signature": False})
    if problem == "expired":
        claims["exp"] = utcnow() - timedelta(seconds=1)
    elif problem == "recipient":
        user.email = "changed@example.com"; db.commit()
    elif problem == "version":
        user.token_version += 1; db.commit()
    elif problem == "disabled":
        profile.is_active = False; db.commit()
    elif problem == "access_token":
        token = login(api, "person").json()["access_token"]
    elif problem == "tampered":
        token = "invalid." + token
    if problem == "expired":
        token = jwt.encode(claims, recovery._key(settings), algorithm="HS256")
    assert reset(api, token).status_code == 400
    db.expire_all()
    assert db.get(User, user.id).password_hash == original


def test_delivery_failure_is_generic_and_never_logs_sensitive_data(configured, monkeypatch, caplog):
    api, db, _, _ = configured
    create_user(db, "person@example.com")
    def failed(*args):
        raise RuntimeError("SECRET-TOKEN recipient@example.com")
    monkeypatch.setattr(recovery_mail, "send", failed)
    assert request(api).status_code == 202
    assert "delivery failed" in caplog.text
    assert "SECRET-TOKEN" not in caplog.text and "recipient@example.com" not in caplog.text


def test_rate_limit_is_uniform_and_origin_is_required(configured):
    api, db, _, sent = configured
    create_user(db, "person@example.com")
    for _ in range(8):
        assert request(api).json() == {"message": recovery.MESSAGE}
    assert len(sent) == 5
    assert api.post("/api/v1/auth/forgot-password",
                    json={"identifier": "person", "identity_kind": "mr"}).status_code == 403
    assert api.post("/api/v1/auth/reset-password",
                    json={"token": "bad", "new_password": NEW}).status_code == 403
    assert reset(api, "bad", "short").status_code == 422


def test_protected_superadmin_recovery_preserves_identity(configured):
    api, db, _, sent = configured
    user, _ = create_user(db, "ignored@example.com", role="super_admin")
    owner = user.id
    assert request(api, user.email, "admin").status_code == 202
    assert reset(api, sent[0][1]).status_code == 200
    db.expire_all()
    user = db.get(User, owner)
    assert user.is_protected_system_admin and user.system_role == "super_admin" and user.is_active
    assert user.email == "crm-admin@allergyevexia.in"


def test_enabled_staff_recovery_uses_encrypted_current_contact(configured):
    from app.db.staff_models import StaffProfile
    from test_staff import admin_headers, BODY, BASE
    api, db, _, sent = configured
    headers, _ = admin_headers(api, db)
    result = api.post(BASE, headers=headers, json=BODY)
    assert result.status_code == 201, result.text
    record = result.json()["record"]
    profile = db.get(StaffProfile, uuid.UUID(record["id"]))
    user = db.get(User, profile.user_id)
    profile.workspace_login_enabled = True
    db.commit()
    request(api, user.username, "admin")
    assert sent[0][0] == BODY["email"] and user.email is None
    assert reset(api, sent[0][1]).status_code == 200
    response = api.post("/api/v1/auth/login", headers=HEADERS,
                        json={"identifier": user.username, "password": NEW, "identity_kind": "admin"})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["identity_kind"] == "staff"


def test_same_password_does_not_consume_link(configured):
    api, db, _, sent = configured
    create_user(db, "person@example.com")
    request(api)
    assert reset(api, sent[0][1], PASSWORD).status_code == 400
    assert reset(api, sent[0][1]).status_code == 200


def test_successful_password_change_invalidates_recovery_link(configured):
    api, db, settings, sent = configured
    user, _ = create_user(db, "person@example.com")
    request(api)
    access = login(api, "person").json()["access_token"]
    identity = auth.identity_from_token(db, access, settings)
    auth.change_password(db, identity, PASSWORD, NEW, "synthetic-change")
    assert reset(api, sent[0][1], "another fictional password").status_code == 400


def test_concurrent_reset_exactly_one_winner(monkeypatch):
    factory = session_factory()
    assert factory.kw["bind"].url.query["host"].startswith("/tmp/evexia-api-test.")
    settings = get_settings()
    sent = []
    monkeypatch.setattr(recovery_mail, "send", lambda _s, _e, token: sent.append(token))
    key = "concurrent-" + uuid.uuid4().hex[:12]
    with factory() as db:
        user, _ = create_user(db, key + "@example.com")
        owner = user.id
        recovery.issue_and_send(db, settings, key, "mr")
    barrier = threading.Barrier(2)
    def attempt():
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                recovery.reset(db, settings, sent[0], NEW, "synthetic-concurrent")
                return "success"
            except auth.AuthError:
                db.rollback()
                return "rejected"
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(lambda _: attempt(), range(2))) == ["rejected", "success"]
    finally:
        with factory() as db:
            for table, column in [("audit_events", "actor_id"), ("refresh_sessions", "user_id"),
                                  ("auth_sessions", "user_id"), ("mr_profiles", "user_id"),
                                  ("account_identifier_reservations", "user_id"), ("users", "id")]:
                db.execute(text(f"DELETE FROM {table} WHERE {column}=:id"), {"id": owner})
            db.commit()


@pytest.mark.parametrize("changes", [
    {"smtp_host": None}, {"smtp_port": 0}, {"smtp_from": "bad"},
    {"password_recovery_url": "http://portal.example.com/reset-password"},
    {"password_recovery_url": "https://user:secret@portal.example.com/reset-password"},
    {"password_recovery_url": "https://portal.example.com/reset-password?return=https://evil.example"},
    {"smtp_username": "user", "smtp_password": None},
])
def test_configuration_fails_globally_not_per_account(configured, changes):
    api, _, settings, _ = configured
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(update=changes)
    assert request(api, "unknown").status_code == 503


@pytest.mark.parametrize("implicit", [False, True])
def test_smtp_requires_verified_tls_before_credentials(configured, monkeypatch, implicit):
    _, _, settings, _ = configured
    settings = settings.model_copy(update={"smtp_implicit_tls": implicit, "smtp_username": "test",
                                          "smtp_password": SecretStr("synthetic-password")})
    events = []
    class SMTP:
        def __init__(self, *args, **kwargs):
            if implicit:
                assert kwargs["context"].check_hostname
            events.append("connect")
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): events.append("ehlo")
        def starttls(self, context):
            assert context.check_hostname
            events.append("tls")
        def login(self, *args): events.append("login")
        def send_message(self, message):
            assert "#token=synthetic-token" in message.get_content()
            assert "15 minutes" in message.get_content()
            events.append("send")
    monkeypatch.setattr(recovery_mail.smtplib, "SMTP_SSL" if implicit else "SMTP", SMTP)
    # Bypass the fixture's application delivery stub, not transport validation.
    from importlib import reload
    mail = reload(recovery_mail)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL" if implicit else "SMTP", SMTP)
    mail.send(settings, "person@example.com", "synthetic-token")
    assert events == (["connect", "login", "send"] if implicit
                      else ["connect", "ehlo", "tls", "ehlo", "login", "send"])
