"""New email-template cases only. Private disposable PostgreSQL and captured SMTP.

Run explicitly:
PYTHONPATH=artifacts/api-server/backend python3 -m pytest -q \
  artifacts/api-server/backend/feature_tests/test_email_templates_feature.py

No shared database, historical migration chain, live settings or real delivery.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError, DBAPIError
from sqlalchemy.orm import Session

from app.api.deps import current_identity
from app.api.v1.email_templates import router
from app.db.email_template_models import EmailTemplate, RECOVERY_TEMPLATE_ID
from app.db.models import AuditEvent, User
from app.db.session import get_db
from app.schemas.email_templates import EmailTemplateInput, EmailTemplateCreate
from app.services import email_templates, email_rendering, recovery_mail, password_recovery

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("email_template_feature_migration",
    ROOT / "alembic/versions/0043_email_templates.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
SEED = {k: v for k, v in migration.SEED.items() if k != "id"}
SEED["event_key"] = "password_recovery"
BASE = "/api/v1/admin/email-templates"


@pytest.fixture(scope="module")
def engine():
    # A private UNIX socket, unique temporary directory, no TCP listener.
    with tempfile.TemporaryDirectory(prefix="email-template-feature-") as tmp:
        data = Path(tmp) / "pg"
        subprocess.run(["initdb", "-D", str(data), "-U", "fixture", "-A", "trust", "--no-locale", "--encoding=UTF8"],
                       check=True, capture_output=True)
        subprocess.run(["pg_ctl", "-D", str(data), "-l", str(Path(tmp) / "postgres.log"),
                        "-o", f"-F -k {tmp} -c listen_addresses='' -p 55439", "-w", "start"],
                       check=True, capture_output=True)
        engine = create_engine(f"postgresql+psycopg://fixture@/postgres?host={tmp}&port=55439",
                               hide_parameters=True)
        try:
            yield engine
        finally:
            engine.dispose()
            subprocess.run(["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"],
                           check=True, capture_output=True)


@pytest.fixture
def db(engine):
    # Minimal predecessor contracts, not unrelated historical migrations.
    with engine.connect() as conn:
        outer = conn.begin()
        User.__table__.create(conn)
        conn.execute(text("CREATE TABLE auth_sessions (id varchar PRIMARY KEY)"))
        AuditEvent.__table__.create(conn)
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
        with Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            yield session
        outer.rollback()


@pytest.fixture
def api(db, monkeypatch):
    actor = SimpleNamespace(user=SimpleNamespace(id=uuid4()), role="super_admin",
                            permissions={"admin.access"}, session_id=None)
    # Raw identity fixture avoids account crypto or unrelated login suites.
    db.execute(text("INSERT INTO users (id,password_hash,is_active,token_version,identity_version,"
                    "is_protected_system_admin) VALUES (:id,'synthetic',true,0,0,false)"),
               {"id": actor.user.id})
    db.commit()
    application = FastAPI()
    application.include_router(router, prefix="/api/v1")
    application.dependency_overrides[get_db] = lambda: db
    application.dependency_overrides[current_identity] = lambda: actor
    monkeypatch.setattr(email_templates, "revalidate_identity", lambda *args, **kwargs: actor)
    with TestClient(application) as client:
        yield client, actor, application


def creation(**changes):
    return dict(SEED, name="Unassigned authored email", event_key=None,
                creation_id=str(uuid4()), **changes)


def test_migration_seed_and_database_protection(db):
    rows = list(db.scalars(select(EmailTemplate)))
    assert len(rows) == 1
    row = rows[0]
    assert row.id == RECOVERY_TEMPLATE_ID and row.event_key == "password_recovery"
    assert row.version == 1 and row.created_by is None and row.provenance == "migration_seed"
    assert row.subject == "Reset your EVEXIA password"
    assert "fictional" not in row.html.lower()
    assert email_templates.resolve_recovery(db).html == row.html
    for sql in (
        "DELETE FROM email_templates",
        "TRUNCATE email_templates",
        "UPDATE email_templates SET event_key=NULL",
        "UPDATE email_templates SET event_key='unknown'",
        "UPDATE email_templates SET id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
        "UPDATE email_templates SET id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', event_key=NULL",
    ):
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(text(sql))


def test_api_persistence_direct_edit_stale_and_metadata_only_audit(api, db):
    client, actor, _ = api
    listing = client.get(BASE)
    assert listing.status_code == 200 and listing.headers["cache-control"] == "no-store"
    assert listing.json()["events"][0]["variables"] == list(email_rendering.VARIABLES)
    row = listing.json()["items"][0]
    assert row["protected"] is True
    changed = {**SEED, "name": "Password recovery", "subject": "Account recovery for {{company_name}}", "version": 1}
    edited = client.post(f"{BASE}/{row['id']}/edit", json=changed)
    assert edited.status_code == 200, edited.text
    assert client.post(f"{BASE}/{row['id']}/edit", json=changed).status_code == 409
    # A fresh session reads the committed API value (within the private fixture).
    with Session(bind=db.get_bind(), join_transaction_mode="create_savepoint") as other:
        saved = other.get(EmailTemplate, RECOVERY_TEMPLATE_ID)
        assert saved.subject == changed["subject"] and saved.version == 2
        assert saved.updated_by == actor.user.id
    audit = db.scalar(select(AuditEvent).where(AuditEvent.action == "email_template_edit"))
    assert audit.actor_id == actor.user.id
    assert audit.reason is None and not hasattr(audit, "html")
    assert client.get(f"{BASE}/{row['id']}").json()["version"] == 2


def test_api_create_delete_uniqueness_protection_and_retry_identity(api, db):
    client, _, _ = api
    body = creation()
    created = client.post(BASE, json=body)
    assert created.status_code == 201, created.text
    assert client.post(BASE, json=body).status_code == 409  # same creation identity
    duplicate = {**body, "creation_id": str(uuid4()), "name": body["name"].upper()}
    assert client.post(BASE, json=duplicate).status_code == 409
    assert client.post(BASE, json={**body, "creation_id": str(uuid4()), "event_key": "password_recovery"}).status_code == 409
    assert client.post(BASE, json={**body, "event_key": "order_paid"}).status_code == 422
    assert client.post(BASE, json={**body, "recipient": "not-accepted@example.org"}).status_code == 422
    assert client.post(BASE, json={**body, "version": True}).status_code == 422
    assert client.post(f"{BASE}/{RECOVERY_TEMPLATE_ID}/delete", json={"version": 1}).status_code == 409
    assert client.post(f"{BASE}/{RECOVERY_TEMPLATE_ID}/edit", json={**SEED, "event_key": None, "version": 1}).status_code == 409
    ident = body["creation_id"]
    assert client.post(f"{BASE}/{ident}/delete", json={"version": 2}).status_code == 409
    assert client.post(f"{BASE}/{ident}/delete", json={"version": 1}).status_code == 200
    assert client.get(f"{BASE}/{ident}").status_code == 404
    assert db.scalar(select(EmailTemplate).where(EmailTemplate.id == RECOVERY_TEMPLATE_ID))


def test_api_authorization_and_revalidation(api, monkeypatch):
    client, actor, application = api
    for role, permissions in (("mr", set()), (None, {"workspace.access"})):
        actor.role = role; actor.permissions = permissions
        for path, method in ((BASE, "get"), (BASE + "/events", "get"),
                             (BASE, "post"), (f"{BASE}/{RECOVERY_TEMPLATE_ID}", "get")):
            response = getattr(client, method)(path, **({"json": creation()} if method == "post" else {}))
            assert response.status_code == 403
    actor.role = "super_admin"; actor.permissions = {"admin.access"}
    application.dependency_overrides.pop(current_identity)
    assert client.get(BASE).status_code == 401
    application.dependency_overrides[current_identity] = lambda: actor
    denied = SimpleNamespace(role=None, permissions=set())
    monkeypatch.setattr(email_templates, "revalidate_identity", lambda *a, **kw: denied)
    assert client.post(BASE, json=creation()).status_code == 403


@pytest.mark.parametrize("field,value", [
    ("subject", "Reset\r\nBcc: victim@example.org"),
    ("subject", "{{unknown}}"),
    ("text", "{{amount}}"),
    ("text", "{{ recipient_name }}"),
    ("text", "{{{recipient_name}}}"),
    ("html", '<script>alert(1)</script>'),
    ("html", '<p onclick="alert(1)">Hello</p>'),
    ("html", '<a href="https://evil.example/reset">Reset</a>'),
    ("html", '<a href="jav&#x61;script:alert(1)">Reset</a>'),
    ("html", '<a href="{{reset_url}}?next=evil">Reset</a>'),
    ("html", '<img src="https://remote.example/image">'),
    ("html", '<p style="background-color:url(https://remote.example)">Test</p>'),
    ("html", '<p title="{{recipient_name}}">Test</p>'),
    ("html", '<p style="width:expression(alert(1))">Test</p>'),
])
def test_reject_unsafe_or_unavailable_content(field, value):
    with pytest.raises(ValidationError):
        EmailTemplateInput(**{**SEED, field: value})


def test_required_link_visible_fallback_and_expiry_not_only_comments():
    for field, value in (("text", "Reset requested."), ("html", SEED["html"].replace("{{expiry_minutes}}", "<!--{{expiry_minutes}}-->")),
                         ("html", SEED["html"].replace(">{{reset_url}}</a>", ">Reset</a>"))):
        with pytest.raises(ValidationError):
            EmailTemplateInput(**{**SEED, field: value})


def test_literal_rendering_escape_and_safe_headers():
    template = EmailTemplateInput(**SEED)
    rendered = email_rendering.render_recovery(
        template, recipient_name='<img src=x> "{{company_name}}"\r\nBcc: nobody',
        reset_url="https://portal.example.org/reset-password#token=synthetic.not-real.token",
        expiry_minutes=15)
    assert "&lt;img src=x&gt;" in rendered.html
    assert "{{company_name}}" in rendered.text  # literal, never recursively substituted
    assert 'href="https://portal.example.org/reset-password#token=synthetic.not-real.token"' in rendered.html
    assert 'src="cid:evexia-logo@evexia"' in rendered.html
    assert "15 minutes" in rendered.text and "15 minutes" in rendered.html
    assert "\r\nBcc:" not in rendered.text
    with pytest.raises(ValueError):
        email_rendering.render_recovery(template, recipient_name="Test",
            reset_url="https://evil.example.org/?token=synthetic", expiry_minutes=15)


def test_strict_bounds_and_version_inputs():
    from app.schemas.email_templates import EmailTemplateEdit
    for field, value in (("name", " " * 10), ("name", "n" * 101), ("description", "d" * 501),
                         ("subject", "s" * 201), ("html", "h" * 100001), ("text", "t" * 20001)):
        with pytest.raises(ValidationError):
            EmailTemplateInput(**{**SEED, field: value})
    for version in (True, "1", 0, -1, 2147483648):
        with pytest.raises(ValidationError):
            EmailTemplateEdit(**SEED, version=version)
    with pytest.raises(ValidationError):
        EmailTemplateCreate(**SEED, creation_id="not-an-id")


def mail_settings():
    return SimpleNamespace(password_recovery_url="https://portal.example.org/reset-password",
        smtp_host="smtp.example.org", smtp_port=587, smtp_from="sender@example.org",
        smtp_username="", smtp_password=SecretStr(""), smtp_implicit_tls=False,
        signing_key="synthetic-feature-only-key-not-used-by-any-deployment",
        jwt_issuer="feature-test", jwt_audience="feature-test")


class CapturedSMTP:
    messages = []
    steps = []
    def __init__(self, *a, **kw):
        self.steps.append("connect")
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def ehlo(self): self.steps.append("ehlo")
    def starttls(self, *, context):
        assert context.check_hostname
        self.steps.append("tls")
    def send_message(self, message):
        self.steps.append("send")
        self.messages.append(message)


def test_captured_multipart_transport_has_owned_inline_logo(monkeypatch):
    CapturedSMTP.messages = []; CapturedSMTP.steps = []
    monkeypatch.setattr(recovery_mail.smtplib, "SMTP", CapturedSMTP)
    rendered = email_rendering.render_recovery(EmailTemplateInput(**SEED), recipient_name="Test",
        reset_url="https://portal.example.org/reset-password#token=synthetic.not-real.token", expiry_minutes=15)
    recovery_mail.send(mail_settings(), "recipient@example.org", rendered)
    message = CapturedSMTP.messages[0]
    assert message.get_content_type() == "multipart/alternative"
    assert CapturedSMTP.steps == ["connect", "ehlo", "tls", "ehlo", "send"]
    assert message.get_body(preferencelist=("plain",)).get_content().strip() == rendered.text.strip()
    assert message.get_body(preferencelist=("html",)).get_content().strip() == rendered.html.strip()
    image = next(p for p in message.walk() if p.get_content_type() == "image/png")
    assert image["Content-ID"] == "<evexia-logo@evexia>"
    assert image.get_payload(decode=True).startswith(b"\x89PNG")
    assert "/images/evexia-logo.png" not in str(message)


def test_recovery_uses_stored_snapshot_and_no_transaction_during_mail(api, db, monkeypatch):
    _, actor, _ = api
    settings = mail_settings()
    user = db.get(User, actor.user.id)
    identity = SimpleNamespace(user=user, staff=object(), mr=None)
    monkeypatch.setattr(password_recovery.account_crypto, "lookup", lambda *_: User.id == user.id)
    monkeypatch.setattr(password_recovery.auth, "_load_identity", lambda *_: identity)
    monkeypatch.setattr(password_recovery, "_recipient", lambda *_: "eligible@example.org")
    row = db.get(EmailTemplate, RECOVERY_TEMPLATE_ID)
    row.subject = "Stored content selected"; db.commit()
    captured = []
    def capture(settings, recipient, rendered):
        assert not db.in_transaction()
        captured.append((recipient, rendered))
    monkeypatch.setattr(recovery_mail, "send", capture)
    password_recovery.issue_and_send(db, settings, "synthetic", "admin")
    assert captured[0][1].subject == "Stored content selected"
    token = captured[0][1].text.split("#token=")[1].split()[0]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == 900
    assert claims["purpose"] == "password_recovery" and claims["kind"] == "admin"
    assert token not in db.get(EmailTemplate, RECOVERY_TEMPLATE_ID).text
    assert list(db.scalars(select(AuditEvent))) == []
    captured.clear()
    identity.staff = None; identity.mr = object()
    password_recovery.issue_and_send(db, settings, "synthetic", "mr")
    assert len(captured) == 1
    captured.clear()
    identity.user = SimpleNamespace(is_protected_system_admin=True, system_role="super_admin")
    password_recovery.issue_and_send(db, settings, "synthetic", "admin")
    assert captured == []
    db.rollback()


def test_invalid_database_mapping_never_falls_back_or_logs_tokens(api, db, monkeypatch, caplog):
    _, actor, _ = api
    settings = mail_settings()
    user = db.get(User, actor.user.id)
    monkeypatch.setattr(password_recovery.account_crypto, "lookup", lambda *_: User.id == user.id)
    monkeypatch.setattr(password_recovery.auth, "_load_identity",
        lambda *_: SimpleNamespace(user=user, staff=object(), mr=None))
    monkeypatch.setattr(password_recovery, "_recipient", lambda *_: "eligible@example.org")
    db.get(EmailTemplate, RECOVERY_TEMPLATE_ID).html = "<script>bad</script>"
    db.commit()
    monkeypatch.setattr(recovery_mail, "send", lambda *a: pytest.fail("invalid source must not send"))
    with pytest.raises(ValidationError):
        password_recovery.issue_and_send(db, settings, "synthetic", "admin")
    monkeypatch.setattr(password_recovery, "issue_and_send",
                        lambda *a: (_ for _ in ()).throw(ValueError("secret-token recipient@example.org")))
    password_recovery.deliver(db.get_bind(), settings, "synthetic", "admin")
    assert "operator investigation required" in caplog.text
    assert "secret-token" not in caplog.text and "recipient@example.org" not in caplog.text
