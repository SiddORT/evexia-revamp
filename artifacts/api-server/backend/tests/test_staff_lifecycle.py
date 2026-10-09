"""Catalogue and soft-delete authorization, ciphertext, auth and inventory bounds."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow
from app.db.designation_models import Designation
from app.db.models import AuditEvent, AuthSession, User
from app.db.staff_models import StaffProfile
from app.schemas.staff import StaffDeletion, StaffFields
from app.services import staff
from app.services.staff_crypto import StaffError
from test_sessions import client
from test_staff import BASE, BODY, admin_headers, seed_designation
from test_migration_0006 import migration_db
from test_migration_staff import prepare, identity


def test_uuid_assignments_derived_names_and_unchanged_unavailable_reference(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    for extra in ({"designation": "Executive"}, {"designationName": "forged"},
                  {"deleted_by": str(actor.id)}, {"deleted_at": "2020-01-01T00:00:00Z"}):
        assert api.post(BASE, headers=headers, json={**BODY, **extra}).status_code == 422
    assert api.post(BASE, headers=headers, json={**BODY, "designation_id": str(uuid.uuid4())}).status_code == 409
    row = api.post(BASE, headers=headers, json=BODY).json()["record"]
    assert row["designationName"] == "Executive" and "designation" not in row
    designation = db.get(Designation, uuid.UUID(BODY["designation_id"]))
    designation.name, designation.status = "Renamed reference", "inactive"
    designation.deleted_at, designation.deleted_by = utcnow(), actor.id
    db.commit()
    assert api.get(BASE + "/" + row["id"], headers=headers).json()["designationName"] == designation.name
    assert api.post(BASE + "/search", headers=headers, json={"query": "Renamed reference"}).json()["items"][0]["id"] == row["id"]
    kept = api.post(BASE + "/" + row["id"] + "/edit", headers=headers,
                    json={**BODY, "name": "New name", "expected_version": 1})
    assert kept.status_code == 200
    assert api.post(BASE, headers=headers, json={**BODY, "email": "other@example.com"}).status_code == 409


def test_soft_deletion_retains_account_ciphertext_access_history_and_revokes_auth(client):
    api, db, settings = client
    headers, actor = admin_headers(api, db)
    created = api.post(BASE, headers=headers, json=BODY).json()
    row, password = created["record"], created["initial_password"]
    role = api.post("/api/v1/admin/roles", headers=headers, json={"name": "Retained deleted Staff role", "description": "synthetic"}).json()
    accessed = api.post(BASE + "/" + row["id"] + "/access", headers=headers,
                        json={"custom_role_id": role["id"], "workspace_login_enabled": True, "expected_version": 1}).json()
    login = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                     json={"identifier": row["userId"], "password": password, "identity_kind": "admin"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    refresh_cookie = dict(api.cookies)
    profile = db.get(StaffProfile, uuid.UUID(row["id"]))
    user = db.get(User, profile.user_id)
    original = {key: getattr(profile, key) for key in ["id", "user_id", "name_ciphertext", "email_ciphertext",
                 "phone_ciphertext", "email_index", "role", "status", "joining_date", "custom_role_id",
                 "workspace_login_enabled", "created_at", "created_by", "designation_id"]}
    credentials = (user.password_hash, user.username, user.token_version, user.identity_version)
    assert api.post(BASE + "/" + row["id"] + "/delete", headers={"Authorization": "Bearer " + token},
                    json={"expected_version": 2}).status_code == 403
    assert api.post(BASE + "/" + row["id"] + "/delete", headers=headers,
                    json={"expected_version": 1}).status_code == 409
    deleted = api.post(BASE + "/" + row["id"] + "/delete", headers=headers,
                       json={"expected_version": accessed["version"]})
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_by"] == str(actor.id) and deleted.json()["deleted_at"]
    assert deleted.json()["version"] == 3 and deleted.json()["status"] == "active"
    db.expire_all()
    profile, user = db.get(StaffProfile, profile.id), db.get(User, user.id)
    assert {key: getattr(profile, key) for key in original} == original
    assert (user.password_hash, user.username, user.token_version, user.identity_version) == credentials
    timestamp = profile.deleted_at
    assert api.post(BASE + "/" + row["id"] + "/delete", headers=headers, json={"expected_version": 3}).status_code == 404
    for route, body in [("edit", {**BODY, "expected_version": 3}), ("status", {"status": "inactive", "expected_version": 3}),
                        ("access", {"custom_role_id": None, "workspace_login_enabled": True, "expected_version": 3})]:
        assert api.post(BASE + "/" + row["id"] + "/" + route, headers=headers, json=body).status_code == 404
    assert api.get(BASE + "/" + row["id"], headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["items"] == []
    assert api.post("/api/v1/admin/roles/" + role["id"] + "/delete", headers=headers,
                    json={"expected_version": role["version"]}).status_code == 409
    assert api.post(BASE + "/search", headers=headers, json={"query": "Executive"}).json()["items"] == []
    assert api.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
    api.cookies.clear(); api.cookies.update(refresh_cookie)
    assert api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"}, json={}).status_code == 401
    assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                    json={"identifier": row["userId"], "password": password}).status_code == 401
    assert api.get("/api/v1/admin/reporting/summary", headers=headers).json()["active_users"] == 1
    assert all(session.status == "REVOKED" for session in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)))
    assert len(list(db.scalars(select(AuditEvent).where(AuditEvent.action == "staff_delete")))) == 1
    from app.services.staff_rotation import rotate
    # Inventory counts tombstones too (same key, no rewrite requested).
    db.commit()
    inventory = rotate(db, settings, target_key_id="primary")
    assert inventory["records"] == 1
    db.expire_all()
    assert db.get(StaffProfile, profile.id).deleted_at == timestamp


def test_concurrent_delete_preserves_first_attribution_and_single_audit(migration_db):
    engine, config, admin, sid, _ = prepare(migration_db)
    command.upgrade(config, "head")
    settings = get_settings()
    with Session(engine) as db:
        seed_designation(db, admin)
        row = staff.create(db, identity(db, admin, sid), StaffFields(**BODY), settings)["record"]
    barrier = Barrier(2)
    def remove():
        with Session(engine) as db:
            actor = identity(db, admin, sid)
            barrier.wait(10)
            try:
                return staff.delete(db, actor, settings, row["id"], StaffDeletion(expected_version=1))
            except StaffError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: remove(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1 and "not_found" in results
    with Session(engine) as db:
        assert db.get(StaffProfile, row["id"]).version == 2
        assert len(list(db.scalars(select(AuditEvent).where(AuditEvent.action == "staff_delete")))) == 1
