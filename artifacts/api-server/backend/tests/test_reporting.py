"""Synthetic reporting/access regressions; run only in the isolated API harness."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.bootstrap import bootstrap_super_admin
from app.core.security import utcnow
from app.db.models import AuditEvent, AuthSession, MRProfile, User
from test_sessions import client, create_user, login, PASSWORD

BASE = "/api/v1/admin/reporting"


def admin_headers(api, db):
    from pydantic import SecretStr
    result = bootstrap_super_admin(db, SecretStr(PASSWORD))
    user = db.get(User, result.user_id)
    response = login(api, user.email)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, user


def add_session(db, user, now, **overrides):
    values = dict(
        id=uuid.uuid4().hex * 2, user_id=user.id, status="ACTIVE", persistent=False,
        token_version=user.token_version, identity_version=user.identity_version,
        created_at=now - timedelta(days=1), expires_at=now + timedelta(days=1),
    )
    values.update(overrides)
    row = AuthSession(**values)
    db.add(row)
    db.flush()
    return row


@pytest.mark.parametrize("resource", ["summary", "users", "sessions", "events"])
def test_all_reports_deny_anonymous_and_mr_even_with_forged_filters(client, resource):
    api, db, _ = client
    user = create_user(db, f"denied-{resource}@example.com")
    path = f"{BASE}/{resource}?user_id={user.id}&limit=100"
    response = api.get(path)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    signed = login(api, user.email)
    response = api.get(path, headers={"Authorization": f"Bearer {signed.json()['access_token']}"})
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"


def test_global_counts_match_effective_auth_rules_without_mutations(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    now = utcnow()
    valid = create_user(db, "valid-report@example.com")
    add_session(db, valid, now)
    add_session(db, valid, now, persistent=True)
    cases = ["disabled", "unmapped", "inactive_mr", "missing_mr", "token", "identity", "expired", "revoked"]
    for case in cases:
        user = create_user(db, f"{case}-report@example.com")
        session = add_session(db, user, now)
        if case == "disabled":
            user.is_active = False
        elif case == "unmapped":
            user.system_role = None
        elif case == "inactive_mr":
            db.scalar(select(MRProfile).where(MRProfile.user_id == user.id)).is_active = False
        elif case == "missing_mr":
            db.delete(db.scalar(select(MRProfile).where(MRProfile.user_id == user.id)))
        elif case == "token":
            user.token_version += 1
        elif case == "identity":
            user.identity_version += 1
        elif case == "expired":
            session.expires_at = now - timedelta(seconds=1)
        else:
            session.status, session.revoked_at = "REVOKED", now
    db.commit()
    before_events = db.scalar(select(func.count(AuditEvent.id)))
    response = api.get(f"{BASE}/summary?user_id={valid.id}&start=2099-01-01T00:00:00Z", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_users"] == 10
    assert body["active_users"] == 2
    assert body["current_session"]["is_current"]
    assert body["current_session"]["user"]["id"] == str(admin.id)
    sessions = api.get(f"{BASE}/sessions?limit=100", headers=headers).json()["items"]
    states = {row["user"]["label"]: row["state"] for row in sessions}
    assert states["expired-report"] == "EXPIRED"
    assert states["revoked-report"] == "REVOKED"
    for case in cases[:-2]:
        assert states[f"{case}-report"] == "INVALIDATED"
    assert db.scalar(select(func.count(AuditEvent.id))) == before_events
    assert db.scalar(select(AuthSession.status).where(
        AuthSession.user_id == db.scalar(select(User.id).where(User.username == "expired-report")),
    )) == "ACTIVE"  # reporting does not materialize expiry transitions
    for forbidden in ["password_hash", "token_hash", "family_id", "token_version",
                      "identity_version", "access_token", "replaced_by_id", "consumed_at"]:
        assert forbidden not in response.text
        assert all(forbidden not in str(row) for row in sessions)


def test_dates_ties_unknown_deleted_actors_safe_projection_and_pagination(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    start = datetime(2030, 2, 2, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    missing = uuid.uuid4()
    ids = [uuid.UUID(int=i) for i in [31, 32, 33, 34]]
    for i, actor in enumerate([admin.id, None, missing, admin.id]):
        db.add(AuditEvent(
            id=ids[i], actor_id=actor, action="file_upload", outcome="success",
            created_at=start if i < 3 else end,
            reason="password=unsafe-legacy-string", request_id="unsafe request secret",
            resource_type="file", resource_id=uuid.uuid4(),
        ))
    add_session(db, admin, start, created_at=start, expires_at=end, id="z" * 40)
    db.commit()
    query = "?start=2030-02-02T00:00:00Z&end=2030-02-03T00:00:00Z&limit=2"
    first = api.get(f"{BASE}/events{query}", headers=headers)
    assert first.status_code == 200, first.text
    assert [row["id"] for row in first.json()["items"]] == [str(ids[2]), str(ids[1])]
    assert first.json()["has_more"]
    assert all(row["user"] is None for row in first.json()["items"])
    assert all(row["reason"] is None and row["request_id"] is None for row in first.json()["items"])
    second = api.get(f"{BASE}/events{query}&offset=2", headers=headers).json()
    assert [row["id"] for row in second["items"]] == [str(ids[0])]
    assert not second["has_more"]
    owned = api.get(f"{BASE}/events{query}&user_id={admin.id}", headers=headers).json()
    assert [row["id"] for row in owned["items"]] == [str(ids[0])]
    deleted = api.get(f"{BASE}/events{query}&user_id={missing}", headers=headers).json()
    assert deleted["items"][0]["user"] is None
    assert deleted["items"][0]["actor_id"] == str(missing)
    sessions = api.get(f"{BASE}/sessions{query}", headers=headers).json()
    assert [row["id"] for row in sessions["items"]] == ["z" * 40]
    assert "unsafe" not in first.text


@pytest.mark.parametrize("query", [
    "start=2030-01-01T00:00:00", "end=bad", "user_id=not-uuid",
    "start=2030-02-03T00:00:00Z&end=2030-02-02T00:00:00Z",
    "start=2030-02-02T00:00:00Z&end=2030-02-02T00:00:00Z",
    "limit=101", "offset=10001", "limit=0", "start=1900-01-01T00:00:00Z",
])
def test_invalid_filters_return_safe_validation_errors(client, query):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for resource in ["sessions", "events"]:
        response = api.get(f"{BASE}/{resource}?{query}", headers=headers)
        assert response.status_code == 422, response.text
        assert "fields" in response.json()["error"]
        assert response.headers["cache-control"] == "no-store"


def test_user_search_paginated_includes_disabled_unmapped_and_literal_wildcards(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for i in range(3):
        db.add(User(email=f"legacy{i}@example.com", password_hash="hidden",
                    system_role=None, is_active=i != 0))
    db.commit()
    first = api.get(f"{BASE}/users?q=legacy&limit=2", headers=headers).json()
    second = api.get(f"{BASE}/users?q=legacy&limit=2&offset=2", headers=headers).json()
    assert first["has_more"] and not second["has_more"]
    rows = first["items"] + second["items"]
    assert len({row["id"] for row in rows}) == 3
    assert {row["account_state"] for row in rows} == {"disabled", "unmapped"}
    assert api.get(f"{BASE}/users?q=%25", headers=headers).json()["items"] == []


@pytest.mark.parametrize("invalidate", ["revoked", "expired", "version"])
def test_current_admin_session_must_remain_valid_for_all_reports(client, invalidate):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    session = db.scalar(select(AuthSession).where(AuthSession.user_id == admin.id))
    if invalidate == "revoked":
        session.status, session.revoked_at = "REVOKED", utcnow()
    elif invalidate == "expired":
        session.created_at = utcnow() - timedelta(hours=2)
        session.expires_at = utcnow() - timedelta(hours=1)
    else:
        admin.token_version += 1
    db.commit()
    for resource in ["summary", "users", "sessions", "events"]:
        assert api.get(f"{BASE}/{resource}", headers=headers).status_code == 401


def test_api_preserves_real_urlsafe_login_session_references(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    user = create_user(db, "urlsafe-session-report@example.com")
    # Exercise the real login/session/audit writers, not manufactured API rows.
    # Each generated identifier is token_urlsafe(32); keep logging in until the
    # alphabet characters under regression are actually present.
    for _ in range(100):
        response = login(api, user.email)
        assert response.status_code == 200
        from test_sessions import session_id_from_response
        sid = session_id_from_response(response, response.json()["access_token"])
        if "-" in sid and "_" in sid:
            break
    else:
        pytest.fail("Could not generate the URL-safe session alphabet fixture")
    events = api.get(f"{BASE}/events?user_id={user.id}&limit=100", headers=headers)
    assert events.status_code == 200
    rows = [row for row in events.json()["items"] if row["action"] in {"login_success", "session_created"}]
    assert any(row["session_id"] == sid and row["action"] == "login_success" for row in rows)
    assert any(row["session_id"] == sid and row["action"] == "session_created" for row in rows)
    sessions = api.get(f"{BASE}/sessions?user_id={user.id}", headers=headers)
    assert any(row["id"] == sid for row in sessions.json()["items"])
