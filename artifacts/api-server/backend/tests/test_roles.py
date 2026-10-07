"""Role metadata API regressions; disposable PostgreSQL only."""
import uuid

import pytest
from sqlalchemy import func, select

from app.db.models import AuditEvent, User
from app.db.role_models import CustomRole
from app.services.auth import Identity, AuthError
from app.services import roles
from app.schemas.roles import RoleFields
from test_sessions import client, create_user, login
from test_reporting import admin_headers

BASE = "/api/v1/admin/roles"


def test_crud_zero_permissions_audit_and_identity_separation(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json()["items"] == []
    row = api.post(BASE, headers=headers, json={"name": " Super Admin ", "description": "Metadata only"}).json()
    assert row["name"] == "Super Admin" and row["permissions"] == [] and row["version"] == 1
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json() == row
    edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                     json={"name": "Super Admin", "description": "", "expected_version": 1})
    assert edited.status_code == 200 and edited.json()["version"] == 2
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"name": "Other", "expected_version": 1}).json()["error"]["code"] == "role_stale"
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers,
                    json={"expected_version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers,
                    json={"expected_version": 2}).status_code == 200
    assert api.get(BASE, headers=headers).json()["items"] == []
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json()["error"]["code"] == "role_deleted"
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"name": "Other", "expected_version": 2}).status_code == 404
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 2}).status_code == 404
    assert api.post(BASE, headers=headers, json={"name": "Next"}).status_code == 201
    assert db.scalar(select(func.count()).select_from(User)) == 1
    current = api.get("/api/v1/auth/me", headers=headers).json()
    assert current["system_role"] == "super_admin" and "admin.access" in current["permissions"]
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_type == "custom_role")))
    assert [e.action for e in events] == ["role_create", "role_update", "role_delete", "role_create"]
    for event in events:
        assert event.actor_id == admin.id and event.session_id and event.request_id
        assert event.outcome == "success" and event.reason is None and event.resource_id
    report = api.get("/api/v1/admin/reporting/events?q=Role%20deleted", headers=headers).json()
    assert any(e["action"] == "role_delete" for e in report["items"])


@pytest.mark.parametrize("body", [
    {"name": ""}, {"name": "  "}, {"name": "x" * 101}, {"name": "bad\nname"},
    {"name": "Okay", "description": "x" * 1001}, {"name": "Okay", "permissions": ["admin.access"]},
    {"name": "Okay", "permissions": []}, {"name": "Okay", "system_role": "super_admin"},
    {"name": "Okay", "private-extra": "private-value"}, {"name": "Okay", "staff_ids": []},
])
def test_validation_forbids_authorization_and_safe_field_errors(client, body):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    response = api.post(BASE, headers=headers, json=body)
    assert response.status_code == 422
    assert "private-extra" not in response.text and "private-value" not in response.text
    assert db.scalar(select(func.count()).select_from(CustomRole)) == 0


def test_duplicate_names_and_bounded_full_directory(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    assert api.post(BASE, headers=headers, json={"name": "Reviewer"}).status_code == 201
    assert api.post(BASE, headers=headers, json={"name": " reviewer "}).json()["error"]["code"] == "role_duplicate"
    row = api.post(BASE, headers=headers, json={"name": "Different"}).json()
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"name": "REVIEWER", "expected_version": 1}).status_code == 409
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json()["version"] == 1
    for n in range(105):
        db.add(CustomRole(name=f"Directory {n}", description=""))
    db.commit()
    ids, cursor = [], None
    while True:
        page = api.get(BASE, headers=headers, params={"limit": 50, **({"cursor": cursor} if cursor else {})}).json()
        ids += [r["id"] for r in page["items"]]
        if not page["has_more"]:
            assert page["next_cursor"] is None
            break
        cursor = page["next_cursor"]
    assert len(ids) == len(set(ids)) == 107 and ids == sorted(ids)
    assert api.get(BASE + "?limit=101", headers=headers).status_code == 422


def test_denied_identities_and_transaction_revalidation(client):
    api, db, _ = client
    row_id = uuid.uuid4()
    paths = [(BASE, {"name": "X"}), (f"{BASE}/{row_id}/edit", {"name": "X", "expected_version": 1}),
             (f"{BASE}/{row_id}/delete", {"expected_version": 1})]
    for path, body in paths:
        assert api.post(path, json=body).status_code == 401
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "roles-mr@example.com")
    mr_headers = {"Authorization": f"Bearer {login(api, mr.email).json()['access_token']}"}
    assert api.get(BASE, headers=mr_headers).status_code == 403
    assert api.get(f"{BASE}/{row_id}", headers=mr_headers).status_code == 403
    for path, body in paths:
        assert api.post(path, headers=mr_headers, json=body).status_code == 403
    headers, admin = admin_headers(api, db)
    from app.services.auth import identity_from_token
    from app.core.config import get_settings
    actor = identity_from_token(db, headers["Authorization"].removeprefix("Bearer "), get_settings())
    admin.token_version += 1
    db.commit()
    with pytest.raises(AuthError):
        roles.mutate(db, actor, RoleFields(name="Must not commit"))
    assert db.scalar(select(func.count()).select_from(CustomRole)) == 0


def test_ordinary_staff_login_and_forged_session_cannot_manage_roles(client):
    api, db, settings = client
    headers, _ = admin_headers(api, db)
    from test_staff import BODY
    from app.db.staff_models import StaffProfile
    from app.db.models import AuthSession
    from app.core.security import access_token, utcnow
    from datetime import timedelta
    created = api.post("/api/v1/admin/staff", headers=headers, json=BODY).json()
    assert api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                    json={"identifier": created["record"]["userId"], "password": created["initial_password"]}).status_code == 401
    profile = db.get(StaffProfile, uuid.UUID(created["record"]["id"]))
    user = db.get(User, profile.user_id)
    session = AuthSession(user_id=user.id, expires_at=utcnow() + timedelta(hours=1),
                          token_version=user.token_version, identity_version=user.identity_version)
    db.add(session)
    db.commit()
    token = access_token(user.id, user.token_version, user.identity_version, settings, session_id=session.id)
    forged = {"Authorization": f"Bearer {token}"}
    role_id = uuid.uuid4()
    for path in (BASE, f"{BASE}/{role_id}"):
        assert api.get(path, headers=forged).status_code == 401
    for path, body in [(BASE, {"name": "X"}), (f"{BASE}/{role_id}/edit", {"name": "X", "expected_version": 1}),
                       (f"{BASE}/{role_id}/delete", {"expected_version": 1})]:
        assert api.post(path, headers=forged, json=body).status_code == 401


def test_commit_connection_loss_has_explicit_unknown_outcome(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    from sqlalchemy.exc import OperationalError
    def lost_commit():
        raise OperationalError("synthetic", {}, Exception("private detail"))
    monkeypatch.setattr(db, "commit", lost_commit)
    response = api.post(BASE, headers=headers, json={"name": "Unknown"})
    assert response.status_code == 503 and response.json()["error"]["code"] == "role_outcome_unknown"
    assert "private detail" not in response.text
