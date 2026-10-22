"""Focused invitation/recovery/email-evidence checks. Synthetic disposable DB only.

Run only this file with scripts/test-api-foundation.sh. SMTP is captured in memory.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
from pathlib import Path
import re
import smtplib
import uuid

import jwt
import pytest
from sqlalchemy import select, text, func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow, verify_password
from app.db.models import User, MRProfile, AuditEvent, AuthSession
from app.db.staff_models import StaffProfile
from app.db.role_models import CustomRole
from app.db.email_delivery_models import EmailAttempt
from app.db.email_template_models import EmailTemplate, INVITATION_TEMPLATE_ID, RECOVERY_TEMPLATE_ID
from app.db.session import session_factory
from app.main import app
from app.services import auth, email_delivery, invitations, password_recovery, recovery_mail, fresh_catalog, email_templates
from test_api import client, create_user, login, PASSWORD
from test_staff import BODY, admin_headers
from test_mrs import fields, add, mr_login, seed_designation

BASE = "/api/v1/admin/reporting"
ORIGIN = {"Origin": "http://testserver"}
NEW = "synthetic new password 2026"
TLS_SEND = recovery_mail.send


@pytest.fixture
def configured(client, monkeypatch):
    api, db, original = client
    settings = original.model_copy(update={"password_recovery_url": "https://portal.example.com/reset-password",
        "smtp_host": "smtp.example.com", "smtp_from": "support@example.com"})
    app.dependency_overrides[get_settings] = lambda: settings
    outbox = []
    monkeypatch.setattr(recovery_mail, "send", lambda _s, recipient, rendered: outbox.append((recipient, rendered)))
    yield api, db, settings, outbox


def token(outbox):
    rendered = outbox[-1][1]
    matches = re.findall(r"#token=([A-Za-z0-9_.-]+)", rendered.text)
    assert matches and matches[0] in rendered.html
    return matches[0]


def invite(api, headers, kind, row):
    return api.post(f"{BASE}/invitations/{kind}/{row['id']}", headers={**headers, **ORIGIN},
                    json={"expected_version": row["version"]})


def complete(api, value, path="set-password"):
    return api.post("/api/v1/auth/" + path, headers=ORIGIN,
                    json={"token": value, "new_password": NEW})


def logs(api, headers, **filters):
    result = api.post(BASE + "/emails", headers={**headers, **ORIGIN}, json=filters)
    assert result.status_code == 200, result.text
    return result.json()


def staff(api, db, chosen=None):
    headers, actor = admin_headers(api, db)
    response = api.post("/api/v1/admin/staff", headers=headers,
                       json={**BODY, **({"initialPassword": chosen} if chosen is not None else {})})
    assert response.status_code == 201, response.text
    saved = response.json()
    role = CustomRole(name="Fictional invitation role", permissions=[], created_by=actor.id, updated_by=actor.id)
    db.add(role); db.commit()
    enabled = api.post("/api/v1/admin/staff/" + saved["record"]["id"] + "/access", headers=headers,
        json={"expected_version": saved["record"]["version"], "custom_role_id": str(role.id), "workspace_login_enabled": True})
    assert enabled.status_code == 200, enabled.text
    return headers, actor, enabled.json(), saved["initial_password"]


def test_staff_chosen_generated_and_invitation_setup(configured):
    api, db, settings, outbox = configured
    headers, actor, row, initial = staff(api, db)
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    owner = db.get(User, profile.user_id)
    assert owner.password_setup_required and verify_password(initial, owner.password_hash)
    assert login(api, row["userId"], initial).status_code == 401
    response = invite(api, headers, "staff", row)
    assert response.status_code == 200 and response.json()["status"] == "smtp_accepted", response.text
    assert not owner.is_protected_system_admin and owner.system_role is None
    assert initial not in outbox[-1][1].text and row["userId"] in outbox[-1][1].text
    value = token(outbox)
    assert complete(api, value).json()["identity_kind"] == "admin"
    assert complete(api, value).status_code == 400
    assert login(api, row["userId"], NEW).status_code == 200
    db.expire_all()
    assert not db.get(User, profile.user_id).password_setup_required
    data = logs(api, headers)
    assert data["total"] == 1 and data["counts"] == {"smtp_accepted": 1}
    assert data["items"][0]["recipient"] == BODY["email"]
    assert data["items"][0]["template_version"] == 1
    assert data["items"][0]["actor_id"] == str(actor.id)
    persisted = db.scalar(select(EmailAttempt))
    assert BODY["email"] not in persisted.recipient_ciphertext
    evidence = " ".join(str(e.__dict__) for e in db.scalars(select(AuditEvent)))
    assert value not in evidence and initial not in evidence and BODY["email"] not in evidence


def test_chosen_staff_password_exact_spaces_and_active_invite_preserved(configured):
    api, db, _, outbox = configured
    chosen = "  exact synthetic password  "
    headers, _, row, initial = staff(api, db, chosen)
    assert initial == chosen
    logged = login(api, row["userId"], chosen)
    assert logged.status_code == 200
    access = logged.json()["access_token"]
    assert invite(api, headers, "staff", row).json()["status"] == "smtp_accepted"
    assert api.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + access}).status_code == 200
    assert complete(api, token(outbox)).status_code == 200
    assert api.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + access}).status_code == 401
    assert login(api, row["userId"], chosen).status_code == 401
    assert login(api, row["userId"], NEW).status_code == 200


def test_mr_invitation_then_forgot_password_correct_portal(configured):
    api, db, _, outbox = configured
    headers, actor = admin_headers(api, db)
    seed_designation(db, actor.id)
    zone = api.post("/api/v1/admin/zones", headers=headers, json={"name": "Invitation Zone", "status": "active"}).json()["id"]
    hq_result = api.post("/api/v1/admin/headquarters", headers=headers,
        json={"name": "Invitation HQ", "zone_id": zone, "status": "active"})
    assert hq_result.status_code == 201, hq_result.text
    hq = hq_result.json()["id"]
    created = add(api, headers, {**fields(hq, zone), "email": "synthetic.mr@example.com"})
    row = created["record"]
    assert invite(api, headers, "mr", row).json()["status"] == "smtp_accepted"
    assert "MR portal" in outbox[-1][1].text and row["userId"] in outbox[-1][1].text
    assert complete(api, token(outbox)).json()["identity_kind"] == "mr"
    assert mr_login(api, row["userId"], NEW).status_code == 200
    assert mr_login(api, row["userId"], NEW, "admin").status_code == 401
    response = api.post("/api/v1/auth/forgot-password", headers=ORIGIN,
                        json={"identifier": row["userId"], "identity_kind": "mr"})
    assert response.status_code == 202
    recovery_token = token(outbox)
    assert complete(api, recovery_token).status_code == 400
    reset = api.post("/api/v1/auth/reset-password", headers=ORIGIN,
        json={"token": recovery_token, "new_password": "another synthetic password 2026"})
    assert reset.status_code == 200, reset.text
    assert mr_login(api, row["userId"], "another synthetic password 2026").status_code == 200
    assert logs(api, headers, purpose="password_recovery")["total"] == 1


@pytest.mark.parametrize("problem", ["expired", "altered", "wrong_purpose", "disabled", "deleted", "recipient", "access"])
def test_invalid_invitation_preserves_password(configured, problem):
    api, db, settings, outbox = configured
    headers, _, row, initial = staff(api, db)
    assert invite(api, headers, "staff", row).status_code == 200
    value = token(outbox)
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    user = db.get(User, profile.user_id)
    original = user.password_hash
    if problem == "expired":
        claims = jwt.decode(value, options={"verify_signature": False})
        claims["exp"] = utcnow() - timedelta(seconds=1)
        value = jwt.encode(claims, password_recovery._key(settings, "account_invitation"), algorithm="HS256")
    elif problem == "altered": value = "x" + value
    elif problem == "wrong_purpose":
        assert complete(api, value, "reset-password").status_code == 400
        return
    elif problem == "disabled": user.is_active = False
    elif problem == "deleted": profile.deleted_at = utcnow(); profile.deleted_by = user.id
    elif problem == "recipient":
        from app.services.staff_crypto import StaffCrypto
        crypto = StaffCrypto(settings)
        profile.email_ciphertext = crypto.encrypt(profile.id, "email", "different@example.com")
        profile.email_index = crypto.email_index("different@example.com")
    elif problem == "access": profile.workspace_login_enabled = False
    db.commit()
    assert complete(api, value).status_code == 400
    db.expire_all()
    assert db.get(User, user.id).password_hash == original


def test_template_edits_protections_filters_and_failure_categories(configured, monkeypatch):
    api, db, settings, outbox = configured
    headers, _, row, _ = staff(api, db)
    template = db.get(EmailTemplate, INVITATION_TEMPLATE_ID)
    template.subject = "Updated {{portal_name}} invitation"; template.version += 1
    template.text += "\nChanged plain text"
    template.html += "<p>Changed HTML</p>"
    db.commit()
    assert invite(api, headers, "staff", row).json()["status"] == "smtp_accepted"
    assert outbox[-1][1].subject == "Updated Admin invitation" and "Changed HTML" in outbox[-1][1].html
    assert logs(api, headers)["items"][0]["template_version"] == 2
    def rejected(*_args): raise smtplib.SMTPRecipientsRefused({"private@example.com": (550, b"SECRET")})
    monkeypatch.setattr(recovery_mail, "send", rejected)
    assert invite(api, headers, "staff", row).json()["status"] == "failed"
    def uncertain(*_args): raise TimeoutError("SECRET")
    monkeypatch.setattr(recovery_mail, "send", uncertain)
    assert invite(api, headers, "staff", row).json()["status"] == "unknown"
    data = logs(api, headers, recipient=BODY["email"].upper())
    assert data["total"] == 3 and data["counts"] == {"smtp_accepted": 1, "failed": 1, "unknown": 1}
    assert logs(api, headers, status="failed")["counts"] == {"failed": 1}
    assert logs(api, headers, recipient="absent@example.com")["total"] == 0
    assert logs(api, headers, offset=100)["total"] == 3
    assert logs(api, headers, start=(utcnow() + timedelta(days=1)).isoformat())["total"] == 0
    assert "SECRET" not in json.dumps(data)
    for key in (INVITATION_TEMPLATE_ID, RECOVERY_TEMPLATE_ID):
        saved = db.get(EmailTemplate, key)
        assert api.post(f"/api/v1/admin/email-templates/{key}/delete", headers=headers, json={"version": saved.version}).status_code == 409


def test_configuration_template_pending_and_eligibility_failures(configured):
    api, db, settings, outbox = configured
    headers, actor, row, _ = staff(api, db)
    broken = settings.model_copy(update={"smtp_host": ""})
    app.dependency_overrides[get_settings] = lambda: broken
    assert invite(api, headers, "staff", row).json()["status"] == "failed"
    assert logs(api, headers)["items"][0]["failure_category"] == "configuration"
    app.dependency_overrides[get_settings] = lambda: settings
    pending_id = email_delivery.record(db, settings, "account_invitation", "admin",
        user_id=db.get(StaffProfile, uuid.UUID(row["id"])).user_id)
    assert invite(api, headers, "staff", row).status_code == 409
    pending = db.get(EmailAttempt, pending_id)
    pending.updated_at = utcnow() - timedelta(minutes=3); db.commit()
    assert logs(api, headers, status="unknown")["total"] == 1
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    profile.workspace_login_enabled = False; db.commit()
    assert invite(api, headers, "staff", row).status_code == 409
    assert not outbox


def test_non_admin_log_and_invitation_denial_and_generic_recovery(configured):
    api, db, _, outbox = configured
    headers, actor = admin_headers(api, db)
    user, _ = create_user(db, "noaccess@example.com")
    mr_headers = {"Authorization": "Bearer " + login(api, user.username).json()["access_token"], **ORIGIN}
    assert api.post(BASE + "/emails", headers=mr_headers, json={}).status_code == 403
    assert api.post(BASE + "/emails", headers=ORIGIN, json={}).status_code == 401
    assert api.post(BASE + "/invitations/mr/" + str(uuid.uuid4()), headers=mr_headers,
        json={"expected_version": 1}).status_code == 403
    known = api.post("/api/v1/auth/forgot-password", headers=ORIGIN,
        json={"identifier": user.username, "identity_kind": "mr"})
    unknown = api.post("/api/v1/auth/forgot-password", headers=ORIGIN,
        json={"identifier": "not-a-real-account", "identity_kind": "mr"})
    protected = api.post("/api/v1/auth/forgot-password", headers=ORIGIN,
        json={"identifier": actor.email, "identity_kind": "admin"})
    assert known.status_code == unknown.status_code == protected.status_code == 202
    assert known.json() == unknown.json() == protected.json() and len(outbox) == 1


def test_concurrent_single_use_actual_committed_database(configured):
    _api, _db, settings, outbox = configured
    engine = session_factory().kw["bind"]
    # Unlike request fixtures, commit this synthetic account outside savepoints so
    # two independent transactions can actually race for the same User row.
    with Session(engine) as db:
        from app.db.designation_models import Designation
        from app.schemas.staff import StaffFields
        from app.services.staff import assign
        from app.services.staff_crypto import StaffCrypto
        user, _ = create_user(db, "concurrent-invitation@example.com", role=None)
        user.email = None
        designation = Designation(name="Concurrent invitation designation", shortName="CI", status="active",
                                  created_by=user.id, updated_by=user.id)
        role = CustomRole(name="Concurrent invitation role", permissions=[], created_by=user.id, updated_by=user.id)
        db.add_all([designation, role]); db.flush()
        profile = StaffProfile(id=uuid.uuid4(), user_id=user.id, created_by=user.id, updated_by=user.id,
                               custom_role_id=role.id, workspace_login_enabled=True)
        assign(profile, StaffFields(**{**BODY, "designation_id": designation.id,
                                      "email": "concurrent-invitation@example.com"}), StaffCrypto(settings))
        db.add(profile); db.commit()
        identity = auth._load_identity(db, user)
        identifier = user.id
        recipient = password_recovery._recipient(identity, settings)
        attempt = email_delivery.record(db, settings, "account_invitation", "admin",
                                         user_id=identifier, recipient=recipient)
        password_recovery.send_identity(db, settings, identity, recipient, "account_invitation", attempt)
    value = token(outbox)
    def consume(_):
        with Session(engine) as db:
            try:
                password_recovery.reset(db, settings, value, NEW, "synthetic-concurrent", purpose="account_invitation")
                return True
            except auth.AuthError:
                db.rollback()
                return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(consume, range(2))) == [False, True]


def test_observe_actual_disposable_catalog(client):
    _api, db, _settings = client
    root = Path(__file__).resolve().parents[4]
    from app.core.schema import SCHEMA_REVISION
    # Keep the original invitation-release observation intact. Each later
    # schema gets its own observed evidence; never relabel old evidence.
    output = root / "generated-artifacts" / f"catalog-{SCHEMA_REVISION}"
    output.mkdir(parents=True, exist_ok=True)
    conn = db.connection()
    projection = fresh_catalog.projection(conn)
    result = {"revision": db.scalar(text("SELECT version_num FROM alembic_version")),
              "postgresql": db.scalar(text("SHOW server_version")),
              "sha256": fresh_catalog.digest(conn),
              "tables": sorted(row[0] for row in projection["relations"] if row[1] in ("r", "p"))}
    assert result["revision"] == SCHEMA_REVISION and "email_attempts" in result["tables"]
    (output / "catalog-observation.json").write_text(json.dumps(result, indent=2) + "\n")


def test_actual_multipart_tls_transport_and_template_failure_logging(configured, monkeypatch):
    api, db, settings, outbox = configured
    headers, _, row, initial = staff(api, db)
    observed = []
    class SMTP:
        def __init__(self, *_args, **kwargs):
            assert kwargs["timeout"] == 10
            self.secure = False
        def __enter__(self): return self
        def __exit__(self, *_args):
            raise ConnectionError("synthetic disconnect during QUIT")
        def ehlo(self): pass
        def starttls(self, context):
            assert context.check_hostname
            self.secure = True
        def send_message(self, message):
            assert self.secure
            kinds = [part.get_content_type() for part in message.walk()]
            assert "text/plain" in kinds and "text/html" in kinds and "image/png" in kinds
            plain = next(p.get_content() for p in message.walk() if p.get_content_type() == "text/plain")
            assert "15 minutes" in plain and initial not in plain and row["userId"] in plain
            observed.append(True)
            return {}
    monkeypatch.setattr(recovery_mail.smtplib, "SMTP", SMTP)
    monkeypatch.setattr(recovery_mail, "send", TLS_SEND)
    assert invite(api, headers, "staff", row).json()["status"] == "smtp_accepted"
    assert observed == [True]  # Observed DATA acceptance survives QUIT failure.
    template = db.get(EmailTemplate, INVITATION_TEMPLATE_ID)
    template.html = "<script>unsupported</script>"
    db.commit()
    assert invite(api, headers, "staff", row).json()["status"] == "failed"
    assert logs(api, headers, status="failed")["items"][0]["failure_category"] == "template"
    assert observed == [True]


def test_migration_preserves_recovery_edits_and_database_required_assignments(client):
    import importlib.util
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy.exc import DBAPIError
    _api, db, _ = client
    conn = db.connection()
    conn.execute(text("CREATE SCHEMA invitation_migration_fixture"))
    conn.execute(text("SET LOCAL search_path=invitation_migration_fixture"))
    User.__table__.create(conn)
    conn.execute(text("ALTER TABLE users DROP COLUMN password_setup_required"))
    root = Path(__file__).resolve().parents[1]
    def load(name):
        spec = __import__("importlib.util", fromlist=[""]).spec_from_file_location(name, root / "alembic/versions" / (name + ".py"))
        module = __import__("importlib.util", fromlist=[""]).module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    with Operations.context(MigrationContext.configure(conn)):
        load("0043_email_templates").upgrade()
        conn.execute(text("UPDATE email_templates SET subject='Retained administrator recovery subject',version=7"))
        load("0053_email_invitations").upgrade()
    assert conn.scalar(text("SELECT subject FROM email_templates WHERE event_key='password_recovery'")) == "Retained administrator recovery subject"
    assert conn.scalar(text("SELECT version FROM email_templates WHERE event_key='password_recovery'")) == 7
    assert conn.scalar(text("SELECT count(*) FROM email_templates")) == 2
    for sql in ("DELETE FROM email_templates WHERE event_key='account_invitation'",
                "UPDATE email_templates SET event_key=NULL WHERE event_key='account_invitation'",
                "TRUNCATE email_templates CASCADE"):
        with pytest.raises(DBAPIError):
            with conn.begin_nested():
                conn.execute(text(sql))
    conn.execute(text("SET LOCAL search_path=public"))
