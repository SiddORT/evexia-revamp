"""Staff regressions against disposable PostgreSQL only; synthetic data."""
import base64
import json
import uuid

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.core.security import verify_password
from app.db.models import AuditEvent, User
from app.db.staff_models import StaffProfile
from app.services.staff_crypto import StaffCrypto, StaffError
from test_sessions import client, create_user, login
from test_reporting import admin_headers as reporting_admin_headers
from app.db.designation_models import Designation

BASE = "/api/v1/admin/staff"
BODY = dict(name="Fictional Staff", email="fictional@example.com", phone="9876543210",
            dialCountry="IN", role="Super Admin", designation_id="31300000-0000-4000-8000-000000000001", dateOfJoining="2025-01-15", status="active")


def seed_designation(db, actor_id, name="Executive"):
    key = uuid.UUID(BODY["designation_id"])
    if not db.get(Designation, key):
        db.add(Designation(id=key, name=name, shortName="EX", status="active",
                           created_by=actor_id, updated_by=actor_id))
        db.commit()
    return key


def admin_headers(api, db):
    headers, actor = reporting_admin_headers(api, db)
    seed_designation(db, actor.id)
    return headers, actor


def test_empty_create_encrypted_credentials_and_reporting(client):
    api, db, _settings = client
    headers, admin = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json()["items"] == []
    response = api.post(BASE, headers=headers, json=BODY)
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    row = body["record"]
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    user = db.get(User, profile.user_id)
    assert user.email is None and user.system_role is None and not user.is_protected_system_admin
    assert user.username == row["userId"] and len(user.username) <= 32
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password(body["initial_password"], user.password_hash)
    assert len(body["initial_password"]) >= 24
    for field in ("name", "email", "phone"):
        encrypted = getattr(profile, f"{field}_ciphertext")
        assert encrypted.startswith("v1:primary:") and BODY[field] not in encrypted
    assert BODY["email"] not in profile.email_index
    event = db.scalar(select(AuditEvent).where(AuditEvent.action == "staff_create"))
    assert event.actor_id == admin.id and event.session_id and event.resource_id == profile.id
    assert not any(BODY[key] in str(event.__dict__) for key in ("email", "phone", "name"))
    for route in (BASE, BASE + "/" + row["id"], "/api/v1/admin/reporting/users", "/api/v1/admin/reporting/events"):
        result = api.get(route, headers=headers)
        assert result.status_code == 200
        assert body["initial_password"] not in result.text
        assert user.password_hash not in result.text
    login_response = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                              json={"identifier": user.username, "password": body["initial_password"]})
    assert login_response.status_code == 401
    summary = api.get("/api/v1/admin/reporting/summary", headers=headers).json()
    assert summary["total_users"] == 2 and summary["active_users"] == 1


def test_edit_status_immutable_credentials_and_stale_drafts(client):
    api, db, _ = client
    headers, _admin = admin_headers(api, db)
    created = api.post(BASE, headers=headers, json=BODY).json()
    row = created["record"]
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    before = profile.name_ciphertext
    password_hash = db.get(User, profile.user_id).password_hash
    changed = {**BODY, "name": "Revised Fictional", "expected_version": 1}
    response = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=changed)
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 2 and response.json()["userId"] == row["userId"]
    assert before != db.get(StaffProfile, profile.id).name_ciphertext
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=changed).json()["error"]["code"] == "staff_stale"
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers, json={"status": "inactive", "expected_version": 1}).status_code == 409
    status = api.post(f"{BASE}/{row['id']}/status", headers=headers, json={"status": "inactive", "expected_version": 2})
    assert status.status_code == 200 and status.json()["status"] == "inactive"
    assert db.get(User, profile.user_id).password_hash == password_hash
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json()["name"] == changed["name"]


@pytest.mark.parametrize("extra", [{"password": "private"}, {"userId": "admin"}, {"system_role": "super_admin"},
                                  {"createdBy": "forged"}, {"name_ciphertext": "forged"}, {"unknown-personal-field": "private"}])
def test_rejects_caller_credentials_roles_and_audit(client, extra):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    result = api.post(BASE, headers=headers, json={**BODY, **extra})
    assert result.status_code == 422 and "private" not in result.text and "unknown-personal-field" not in result.text
    assert db.scalar(select(func.count()).select_from(StaffProfile)) == 0


@pytest.mark.parametrize("changes", [{"name": ""}, {"email": "invalid"}, {"phone": "123"},
                                    {"dialCountry": "XX"}, {"role": "root"}, {"status": "enabled"},
                                    {"designation": "x" * 201}, {"dateOfJoining": "2999-01-01"}])
def test_invalid_fields_atomic(client, changes):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    assert api.post(BASE, headers=headers, json={**BODY, **changes}).status_code == 422
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_duplicate_email_and_denials(client):
    api, db, _ = client
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "staff-test-mr@example.com")
    mr_headers = {"Authorization": f"Bearer {login(api, mr.email).json()['access_token']}"}
    assert api.get(BASE, headers=mr_headers).status_code == 403
    assert api.post(BASE, headers=mr_headers, json=BODY).status_code == 403
    headers, _ = admin_headers(api, db)
    assert api.post(BASE, headers=headers, json=BODY).status_code == 201
    assert api.post(BASE, headers=headers, json={**BODY, "email": "FICTIONAL@EXAMPLE.COM"}).status_code == 409
    assert db.scalar(select(func.count()).select_from(StaffProfile)) == 1
    assert db.scalar(select(func.count()).select_from(User)) == 3
    assert api.get(BASE + "/" + str(uuid.uuid4()), headers=headers).status_code == 404


def test_wrong_keys_missing_keys_and_tampering_fail_closed_without_breaking_auth(client, monkeypatch):
    api, db, settings = client
    headers, _ = admin_headers(api, db)
    row = api.post(BASE, headers=headers, json=BODY).json()["record"]
    for field, value in [
        ("staff_encryption_keys", None),
        ("staff_encryption_keys", SecretStr(json.dumps({"primary": base64.b64encode(b"C" * 32).decode()}))),
        ("staff_email_index_key", SecretStr(base64.b64encode(b"D" * 32).decode())),
    ]:
        original = getattr(settings, field)
        monkeypatch.setattr(settings, field, value)
        assert api.get(BASE, headers=headers).status_code == 503
        assert api.post(BASE, headers=headers, json={**BODY, "email": "second@example.com"}).status_code == 503
        assert api.get("/api/v1/auth/me", headers=headers).status_code == 200
        monkeypatch.setattr(settings, field, original)
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    profile.name_ciphertext = profile.phone_ciphertext
    db.commit()
    assert api.get(BASE, headers=headers).status_code == 503
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers, json={"status": "inactive", "expected_version": 1}).status_code == 503
    assert db.scalar(select(func.count()).select_from(StaffProfile)) == 1


def test_crypto_randomness_record_field_binding_and_rotation(client):
    _, _, settings = client
    crypto = StaffCrypto(settings)
    first, second = uuid.uuid4(), uuid.uuid4()
    a, b = crypto.encrypt(first, "name", "same"), crypto.encrypt(first, "name", "same")
    assert a != b and crypto.decrypt(first, "name", a) == "same"
    for record, field in [(first, "email"), (second, "name")]:
        with pytest.raises(StaffError):
            crypto.decrypt(record, field, a)


def test_username_collision_is_retried_without_rehashing_or_partial_rows(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    first = api.post(BASE, headers=headers, json=BODY).json()["record"]
    from app.services import staff
    choices = iter([first["userId"][3:], "e" * 28])
    monkeypatch.setattr(staff.secrets, "token_hex", lambda size: next(choices))
    response = api.post(BASE, headers=headers, json={**BODY, "email": "new@example.com"})
    assert response.status_code == 201, response.text
    assert response.json()["record"]["userId"] == "st_" + "e" * 28
    assert db.scalar(select(func.count()).select_from(StaffProfile)) == 2


def test_commit_failure_rolls_back_both_profile_and_credentials(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    original = db.commit
    def fail():
        raise IntegrityError("synthetic", None, Exception())
    monkeypatch.setattr(db, "commit", fail)
    assert api.post(BASE, headers=headers, json=BODY).status_code == 409
    monkeypatch.setattr(db, "commit", original)
    assert db.scalar(select(func.count()).select_from(StaffProfile)) == 0
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_database_forbids_email_less_legacy_and_staff_elevation(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    row = api.post(BASE, headers=headers, json=BODY).json()["record"]
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    for sql, params in [
        ("UPDATE users SET system_role = 'mr' WHERE id = :id", {"id": profile.user_id}),
        ("UPDATE users SET email = 'duplicate@example.com' WHERE id = :id", {"id": profile.user_id}),
        ("UPDATE users SET username = 'changed' WHERE id = :id", {"id": profile.user_id}),
    ]:
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text(sql), params)
                db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
