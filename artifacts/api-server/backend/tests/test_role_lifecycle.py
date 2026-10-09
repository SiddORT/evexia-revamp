"""Role retention, spoofing, all-assignment guards and fail-closed corruption."""
import uuid
from datetime import datetime

import pytest
from sqlalchemy import select

from app.core.security import utcnow
from app.db.models import AuditEvent, User
from app.db.role_models import CustomRole
from app.db.staff_models import StaffProfile
from app.services import auth
from test_sessions import client
from test_zone_permissions import setup, bearer, staff_login, ROLES, STAFF, ZONES, ORIGIN


def test_attribution_and_soft_delete_keep_grants_names_and_original_evidence(client):
    api, db, _ = client
    headers, actor, role, record, _ = setup(api, db, ["zone.add", "doctor.import"])
    row_id = uuid.UUID(role["id"])
    assert role["created_by"] == role["updated_by"] == str(actor.id)
    for endpoint, payload in [
        ("", {"name": "Forged"}),
        (f"/{row_id}/edit", {"name": "Forged", "expected_version": role["version"]}),
        (f"/{row_id}/permissions", {"permissions": [], "expected_version": role["version"]}),
        (f"/{row_id}/delete", {"expected_version": role["version"]}),
    ]:
        for field, value in (("created_by", str(actor.id)), ("updated_by", str(actor.id)),
                             ("deleted_by", str(actor.id)), ("deleted_at", utcnow().isoformat())):
            assert api.post(ROLES + endpoint, headers=headers, json={**payload, field: value}).status_code == 422
    assert api.post(f"{STAFF}/{record['id']}/access", headers=headers,
                    json={"custom_role_id": None, "workspace_login_enabled": False,
                          "expected_version": record["version"]}).status_code == 200
    deleted = api.post(f"{ROLES}/{row_id}/delete", headers=headers,
                       json={"expected_version": role["version"]})
    assert deleted.status_code == 200
    tombstone = deleted.json()
    assert tombstone["version"] == role["version"] + 1
    assert tombstone["deleted_at"] == tombstone["updated_at"]
    assert tombstone["deleted_by"] == tombstone["updated_by"] == str(actor.id)
    assert tombstone["created_by"] == role["created_by"]
    stored = db.get(CustomRole, row_id, populate_existing=True)
    assert set(stored.permissions) == {"zone.add", "doctor.import"} and stored.name == role["name"]
    for version in (role["version"], tombstone["version"]):
        assert api.post(f"{ROLES}/{row_id}/delete", headers=headers, json={"expected_version": version}).status_code == 404
    assert api.post(f"{ROLES}/{row_id}/permissions", headers=headers,
                    json={"permissions": [], "expected_version": tombstone["version"]}).status_code == 404
    assert api.post(ROLES, headers=headers, json={"name": role["name"]}).json()["error"]["code"] == "role_duplicate"
    assert len(list(db.scalars(select(AuditEvent).where(AuditEvent.resource_id == row_id,
                                                      AuditEvent.action == "role_delete")))) == 1
    assert stored.deleted_at == datetime.fromisoformat(tombstone["deleted_at"].replace("Z", "+00:00"))


@pytest.mark.parametrize("state", ["active", "inactive", "disabled", "deleted"])
def test_every_retained_staff_reference_blocks_role_deletion(client, state):
    api, db, _ = client
    admin, _, role, record, _ = setup(api, db)
    profile = db.get(StaffProfile, uuid.UUID(record["id"]))
    if state == "inactive":
        profile.status = "inactive"
    if state == "disabled":
        profile.workspace_login_enabled = False
    if state == "deleted":
        response = api.post(f"{STAFF}/{record['id']}/delete", headers=admin,
                            json={"expected_version": record["version"]})
        assert response.status_code == 200
    else:
        db.commit()
    response = api.post(f"{ROLES}/{role['id']}/delete", headers=admin,
                        json={"expected_version": role["version"]})
    assert response.status_code == 409 and response.json()["error"]["code"] == "role_assigned"
    assert db.get(CustomRole, uuid.UUID(role["id"]), populate_existing=True).deleted_at is None
    if state == "deleted":
        assert api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                        json={"custom_role_id": None, "workspace_login_enabled": False,
                              "expected_version": response.json().get("version", 3)}).status_code == 404


def test_corrupt_assigned_tombstone_never_grants_or_accepts_assignment(client):
    api, db, _ = client
    admin, owner, role, record, password = setup(api, db, ["zone.add", "zone.export"])
    token = bearer(staff_login(api, record, password))
    profile = db.get(StaffProfile, uuid.UUID(record["id"]))
    user = db.get(User, profile.user_id)
    snapshot = auth._load_identity(db, user)
    row = db.get(CustomRole, uuid.UUID(role["id"]))
    row.deleted_at, row.deleted_by = utcnow(), owner.id
    db.commit()  # Synthetic corruption fixture only: bypass application deletion guard.
    assert api.get(ZONES, headers=token).status_code == 401
    assert api.get("/api/v1/auth/me", headers=token).status_code == 401
    assert api.post("/api/v1/auth/refresh", headers=ORIGIN).status_code == 401
    assert staff_login(api, record, password).status_code == 401
    with pytest.raises(auth.AuthError):
        auth._load_identity(db, snapshot.user, lock=True)
    db.rollback()
    for enabled in (False, True):
        response = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                            json={"custom_role_id": role["id"], "workspace_login_enabled": enabled,
                                  "expected_version": record["version"]})
        assert response.status_code == 409 and response.json()["error"]["code"] == "role_deleted"
    assert api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                    json={"custom_role_id": None, "workspace_login_enabled": False,
                          "expected_version": record["version"]}).status_code == 200
    assert set(db.get(CustomRole, row.id, populate_existing=True).permissions) == {"zone.add", "zone.export"}
