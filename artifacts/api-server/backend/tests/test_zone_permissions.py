"""Explicit restricted staff identities, grants and deny-by-default API checks."""
import hashlib
import uuid

import pytest
from sqlalchemy import select

from app.db.models import AuditEvent, AuthSession, User
from app.db.staff_models import StaffProfile
from app.db.download_models import DownloadLog
from app.services.zone_policy import ZONE_ACTIONS
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_staff import BODY

ROLES = "/api/v1/admin/roles"
STAFF = "/api/v1/admin/staff"
ZONES = "/api/v1/admin/zones"
ORIGIN = {"Origin": "http://testserver"}


def setup(api, db, grants=(), enabled=True):
    admin, owner = admin_headers(api, db)
    role = api.post(ROLES, headers=admin, json={"name": "Super Admin", "description": "Custom, not system"}).json()
    if grants:
        role = api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                        json={"permissions": list(grants), "expected_version": role["version"]}).json()
    created = api.post(STAFF, headers=admin, json=BODY).json()
    record = created["record"]
    assert not record["workspace_login_enabled"] and record["custom_role_id"] is None
    if enabled:
        response = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                            json={"custom_role_id": role["id"], "workspace_login_enabled": True,
                                  "expected_version": record["version"]})
        assert response.status_code == 200, response.text
        record = response.json()
    return admin, owner, role, record, created["initial_password"]


def staff_login(api, record, password):
    return api.post("/api/v1/auth/login", headers=ORIGIN,
                    json={"identifier": record["userId"], "password": password})


def bearer(response):
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_legacy_opt_in_none_and_label_spoofing(client):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, enabled=False)
    assert staff_login(api, record, password).status_code == 401
    access = {"custom_role_id": None, "workspace_login_enabled": True, "expected_version": 1}
    response = api.post(f"{STAFF}/{record['id']}/access", headers=admin, json=access)
    assert response.status_code == 200
    authenticated = staff_login(api, record, password)
    headers = bearer(authenticated)
    user = authenticated.json()["user"]
    assert user["identity_kind"] == "staff" and user["system_role"] is None and user["email"] is None
    assert user["permissions"] == ["workspace.access"]
    assert api.get(ZONES, headers=headers).status_code == 403
    assigned = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                        json={**access, "custom_role_id": role["id"], "expected_version": 2}).json()
    assert assigned["role"] == "Super Admin" and assigned["version"] == 3
    assert api.get(ZONES, headers=headers).status_code == 403
    refreshed = api.post("/api/v1/auth/refresh", headers=ORIGIN)
    assert refreshed.status_code == 200 and refreshed.json()["user"]["permissions"] == ["workspace.access"]
    assert api.get("/api/v1/auth/me", headers=bearer(refreshed)).status_code == 200


@pytest.mark.parametrize("grant", sorted(ZONE_ACTIONS))
def test_single_action_independence_and_admin_bypass(client, grant):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, [grant])
    original = api.post(ZONES, headers=admin, json={"name": "Initial", "status": "active"}).json()
    headers = bearer(staff_login(api, record, password))
    assert api.get(ZONES, headers=headers).status_code == 200
    assert api.get(f"{ZONES}/{original['id']}", headers=headers).status_code == 200
    assert api.get(ZONES + "/trash", headers=headers).status_code == 403
    assert api.post(f"{ZONES}/{original['id']}/restore", headers=headers,
                    json={"expected_version": original["version"]}).status_code == 403
    created = api.post(ZONES, headers=headers, json={"name": "Manual", "status": "active"})
    assert created.status_code == (201 if grant == "zone.add" else 403), created.text
    edited = api.post(f"{ZONES}/{original['id']}/edit", headers=headers,
                      json={"name": "Revised", "status": "active", "expected_version": 1})
    assert edited.status_code == (200 if grant == "zone.edit" else 403), edited.text
    version = edited.json()["version"] if edited.status_code == 200 else 1
    status = api.post(f"{ZONES}/{original['id']}/status", headers=headers,
                     json={"status": "inactive", "expected_version": version})
    assert status.status_code == (200 if grant == "zone.edit" else 403), status.text
    version = status.json()["version"] if status.status_code == 200 else version
    for format in ("csv", "xlsx"):
        exported = api.get(ZONES + "/export?format=" + format, headers=headers)
        assert exported.status_code == (200 if grant == "zone.export" else 403), exported.text[:200]
        if exported.status_code == 200:
            assert exported.headers["X-Download-Log"]
    data = b"Zone Name,Status\nImported,active\n"
    review = api.post(ZONES + "/import/review?filename=zones.csv", headers=headers, content=data)
    assert review.status_code == (200 if grant == "zone.import" else 403), review.text
    commit = api.post(ZONES + "/import/commit", params={"filename": "zones.csv", "confirm": "true",
                      "digest": hashlib.sha256(data).hexdigest()}, headers=headers, content=data)
    assert commit.status_code == (200 if grant == "zone.import" else 403), commit.text
    sample = api.post("/api/v1/admin/reporting/downloads/initiate", headers={**headers, **ORIGIN},
                     json={"initiation_id": str(uuid.uuid4()), "source": "zone", "kind": "sample", "format": "XLSX"})
    assert sample.status_code == (200 if grant == "zone.import" else 403), sample.text
    deleted = api.post(f"{ZONES}/{original['id']}/delete", headers=headers,
                      json={"expected_version": version})
    assert deleted.status_code == (200 if grant == "zone.delete" else 403), deleted.text
    assert api.get(ZONES, headers=admin).status_code == 200
    assert api.get(ZONES + "/trash", headers=admin).status_code == 200
    logs = list(db.scalars(select(DownloadLog)))
    assert len(logs) == (2 if grant == "zone.export" else 1 if grant == "zone.import" else 0)
    for log in logs:
        assert log.actor_id == db.get(StaffProfile, uuid.UUID(record["id"])).user_id and log.session_id
    for path in (ROLES, STAFF, "/api/v1/admin/reporting/downloads", "/api/v1/admin/reporting/summary",
                 "/api/v1/admin/reporting/users", "/api/v1/admin/reporting/sessions",
                 "/api/v1/admin/reporting/events", "/api/v1/admin/courier-partners",
                 "/api/v1/admin/storage-locations"):
        assert api.get(path, headers=headers).status_code == 403, path
    assert api.post("/api/v1/domain/patients", headers=headers, json={}).status_code == 403
    assert api.post("/api/v1/admin/reporting/downloads/initiate", headers={**headers, **ORIGIN},
                    json={"initiation_id": str(uuid.uuid4()), "source": "staff", "kind": "export", "format": "CSV"}).status_code == 403


def test_permission_metadata_preservation_stale_deletion_and_audits(client):
    api, db, _ = client
    admin, owner, role, record, password = setup(api, db, ZONE_ACTIONS)
    headers = bearer(staff_login(api, record, password))
    edited = api.post(f"{ROLES}/{role['id']}/edit", headers=admin,
                     json={"name": "Renamed", "description": "Retained", "expected_version": role["version"]}).json()
    assert set(edited["permissions"]) == ZONE_ACTIONS
    assert api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                    json={"permissions": [], "expected_version": role["version"]}).status_code == 409
    assert api.post(f"{ROLES}/{role['id']}/delete", headers=admin,
                    json={"expected_version": edited["version"]}).json()["error"]["code"] == "role_assigned"
    cleared = api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                      json={"permissions": [], "expected_version": edited["version"]}).json()
    assert cleared["name"] == "Renamed" and cleared["description"] == "Retained"
    assert cleared["permissions"] == []
    assert api.get(ZONES, headers=headers).status_code == 403
    assert api.get(ZONES + "/export", headers=headers).status_code == 403
    # Current-user and refresh resolve grants afresh, not from JWT role claims.
    assert api.get("/api/v1/auth/me", headers=headers).json()["permissions"] == ["workspace.access"]
    assert api.post("/api/v1/auth/refresh", headers=ORIGIN).json()["user"]["permissions"] == ["workspace.access"]
    unassigned = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                         json={"custom_role_id": None, "workspace_login_enabled": True,
                               "expected_version": record["version"]})
    assert unassigned.status_code == 200
    assert api.post(f"{ROLES}/{role['id']}/delete", headers=admin,
                    json={"expected_version": cleared["version"]}).status_code == 200
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.action.in_(["role_permissions", "staff_access"]))))
    assert len(events) == 4
    assert all(e.actor_id == owner.id and e.session_id and e.created_at and e.request_id for e in events)


@pytest.mark.parametrize("mode", ["disable", "inactive", "delete", "user_inactive"])
def test_sessions_fail_closed_after_access_loss(client, mode):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, ZONE_ACTIONS)
    headers = bearer(staff_login(api, record, password))
    profile = db.get(StaffProfile, uuid.UUID(record["id"]))
    user_id = profile.user_id
    if mode == "disable":
        assert api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                        json={"custom_role_id": role["id"], "workspace_login_enabled": False,
                              "expected_version": record["version"]}).status_code == 200
    elif mode == "inactive":
        assert api.post(f"{STAFF}/{record['id']}/status", headers=admin,
                        json={"status": "inactive", "expected_version": record["version"]}).status_code == 200
    elif mode == "delete":
        db.delete(profile)
        db.commit()
    else:
        db.get(User, user_id).is_active = False
        db.commit()
    assert api.get(ZONES, headers=headers).status_code == 401
    assert api.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert api.post("/api/v1/auth/refresh", headers=ORIGIN).status_code == 401
    assert staff_login(api, record, password).status_code == 401
    if mode in ("disable", "inactive"):
        assert all(s.status == "REVOKED" for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user_id)))


@pytest.mark.parametrize("grants", [["admin.access"], ["zone.view"], ["zone.restore"], ["All"], ["zone.add", "zone.add"]])
def test_unknown_grants_and_system_assignment_forbidden(client, grants):
    api, db, _ = client
    admin, owner, role, record, _ = setup(api, db)
    assert api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                    json={"permissions": grants, "expected_version": role["version"]}).status_code == 422
    assert api.post(f"{STAFF}/{owner.id}/access", headers=admin,
                    json={"custom_role_id": role["id"], "workspace_login_enabled": False, "expected_version": 1}).status_code == 404
    assert api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                    json={"custom_role_id": str(uuid.uuid4()), "workspace_login_enabled": True,
                          "expected_version": record["version"]}).status_code == 409
    assert api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                    json={"custom_role_id": role["id"], "workspace_login_enabled": True,
                          "expected_version": 1}).status_code == 409
    current = api.get("/api/v1/auth/me", headers=admin).json()
    assert current["system_role"] == "super_admin" and "admin.access" in current["permissions"]


def test_revoked_review_and_mr_anonymous_denial(client):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, ["zone.import"])
    headers = bearer(staff_login(api, record, password))
    data = b"Zone Name,Status\nNever committed,active\n"
    review = api.post(ZONES + "/import/review?filename=z.csv", headers=headers, content=data).json()
    assert review["valid"]
    api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
             json={"permissions": [], "expected_version": role["version"]})
    assert api.post(ZONES + "/import/commit", headers=headers, content=data,
                    params={"filename": "z.csv", "confirm": "true", "digest": review["digest"]}).status_code == 403
    assert api.get(ZONES, headers=admin).json()["total"] == 0
    mr = create_user(db, "restricted-mr@example.com")
    mr_headers = bearer(login(api, mr.email))
    assert api.get(ZONES, headers=mr_headers).status_code == 403
    assert api.get(ZONES).status_code == 401
    assert api.post(f"{ROLES}/{role['id']}/permissions", headers=mr_headers,
                    json={"permissions": ["zone.add"], "expected_version": 1}).status_code == 403


def test_staff_single_session_rotation_and_disabled_session_never_resumes(client):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, ["zone.add"])
    first = staff_login(api, record, password)
    old_headers = bearer(first)
    old_cookie = api.cookies.get("evexia_refresh")
    current = bearer(staff_login(api, record, password))
    replaced = api.get(ZONES, headers=old_headers)
    assert replaced.status_code == 401 and replaced.headers["X-Session-Reason"] == "replaced"
    assert api.get(ZONES, headers=current).status_code == 200
    rotated = api.post("/api/v1/auth/refresh", headers=ORIGIN)
    assert rotated.status_code == 200
    # An owner-bound old cookie cannot revoke the newer session.
    replay = api.post("/api/v1/auth/refresh", headers={**ORIGIN, "Cookie": f"evexia_refresh={old_cookie}"})
    assert replay.status_code == 401
    assert api.get(ZONES, headers=current).status_code == 200
    disabled = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                        json={"custom_role_id": role["id"], "workspace_login_enabled": False,
                              "expected_version": record["version"]}).json()
    enabled = api.post(f"{STAFF}/{record['id']}/access", headers=admin,
                       json={"custom_role_id": role["id"], "workspace_login_enabled": True,
                             "expected_version": disabled["version"]})
    assert enabled.status_code == 200
    assert api.get(ZONES, headers=current).status_code == 401
    assert api.get(ZONES, headers=bearer(staff_login(api, record, password))).status_code == 200
