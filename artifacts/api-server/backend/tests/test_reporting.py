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


def activity_batch(action="page_view", resource="zone"):
    return {"events": [{"event_id": str(uuid.uuid4()), "action": action, "resource": resource}]}


def test_browser_activity_is_session_bound_metadata_only_and_idempotent(client):
    api, db, _ = client
    headers, user = admin_headers(api, db)
    headers["Origin"] = "http://testserver"
    batch = activity_batch("created", "patient")
    assert api.post(f"{BASE}/activity", headers=headers, json=batch).status_code == 204
    assert api.post(f"{BASE}/activity", headers=headers, json=batch).status_code == 204
    rows = db.scalars(select(AuditEvent).where(AuditEvent.reason == "browser_reported")).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_id == user.id and row.session_id
    assert row.action == "browser_created" and row.resource_type == "patient"
    assert row.outcome == "reported" and row.resource_id is None
    report = api.get(f"{BASE}/events", headers=headers).json()
    assert any(e["id"] == str(row.id) and e["reason"] == "browser_reported" for e in report["items"])
    assert not any(key in batch["events"][0] for key in ("user_id", "session_id", "password"))


@pytest.mark.parametrize("extra", [
    {"user_id": str(uuid.uuid4())}, {"session_id": "another-session"},
    {"password": "NEVER_STORE"}, {"record": {"patient": "NEVER_STORE"}},
])
def test_browser_activity_rejects_identity_substitution_and_contents(client, extra):
    api, db, _ = client
    headers, _user = admin_headers(api, db)
    headers["Origin"] = "http://testserver"
    body = activity_batch()
    body["events"][0].update(extra)
    assert api.post(f"{BASE}/activity", headers=headers, json=body).status_code == 422
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.reason == "browser_reported")) == 0


def test_browser_activity_denies_anonymous_cross_origin_and_revoked_sessions(client):
    api, db, _ = client
    assert api.post(f"{BASE}/activity", headers={"Origin": "http://testserver"}, json=activity_batch()).status_code == 401
    headers, _user = admin_headers(api, db)
    headers["Origin"] = "https://untrusted.example"
    assert api.post(f"{BASE}/activity", headers=headers, json=activity_batch()).status_code == 403
    headers["Origin"] = "http://testserver"
    assert api.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert api.post(f"{BASE}/activity", headers=headers, json=activity_batch()).status_code == 401


def test_browser_activity_limits_batches_and_per_session_volume(client):
    api, db, _ = client
    headers, _user = admin_headers(api, db)
    headers["Origin"] = "http://testserver"
    assert api.post(f"{BASE}/activity", headers=headers, json={"events": []}).status_code == 422
    oversized = {"events": [activity_batch()["events"][0] for _ in range(21)]}
    assert api.post(f"{BASE}/activity", headers=headers, json=oversized).status_code == 422
    batches = [{"events": [activity_batch()["events"][0] for _ in range(20)]} for _ in range(6)]
    for batch in batches:
        assert api.post(f"{BASE}/activity", headers=headers, json=batch).status_code == 204
    assert api.post(f"{BASE}/activity", headers=headers, json=batches[0]).status_code == 204
    assert api.post(f"{BASE}/activity", headers=headers, json=activity_batch()).status_code == 429


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


@pytest.mark.parametrize("resource", ["summary", "users", "sessions", "events", "sessions/export", "events/export"])
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


def test_session_search_combines_with_effective_state_dates_user_and_pages(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    user = create_user(db, "searchable-sessions@example.com")
    now = utcnow()
    rows = [add_session(db, user, now, id=f"SearchRef{i:02d}", created_at=now - timedelta(minutes=i))
            for i in range(28)]
    rows[0].status, rows[0].revoked_at = "REVOKED", now
    rows[1].expires_at = now - timedelta(seconds=1)
    rows[2].token_version = user.token_version + 1
    db.commit()
    query = f"{BASE}/sessions?q=SEARCHable&user_id={user.id}&limit=25"
    first = api.get(query, headers=headers)
    second = api.get(f"{query}&offset=25", headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json()["has_more"] and not second.json()["has_more"]
    assert len(first.json()["items"]) == 25 and len(second.json()["items"]) == 3
    assert [r["id"] for r in first.json()["items"] + second.json()["items"]] == [
        f"SearchRef{i:02d}" for i in range(28)]
    for state, expected in [("ACTIVE", 25), ("REVOKED", 1), ("EXPIRED", 1), ("INVALIDATED", 1)]:
        response = api.get(f"{query}&state={state}", headers=headers)
        assert response.status_code == 200
        assert len(response.json()["items"]) == expected
    by_ref = api.get(f"{BASE}/sessions?q=ref27&state=ACTIVE", headers=headers).json()
    assert [row["id"] for row in by_ref["items"]] == ["SearchRef27"]
    assert api.get(f"{query}&q=%25", headers=headers).json()["items"] == []
    assert api.get(f"{query}&start=2099-01-01T00:00:00Z", headers=headers).json()["items"] == []
    for invalid in ["state=WRONG", f"q={'x' * 101}"]:
        assert api.get(f"{BASE}/sessions?{invalid}", headers=headers).status_code == 422
    for forbidden in ["password_hash", "token_hash", "family_id", "access_token"]:
        assert forbidden not in first.text


def test_event_search_entire_history_safe_labels_filters_and_exports(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    user = create_user(db, "search-events@example.com")
    user.username = "Event Search Actor"
    start = datetime(2030, 2, 2, tzinfo=timezone.utc)
    reference = uuid.uuid4()
    ids = []
    for i in range(28):
        add_session(db, user, start, id=f"SafeEventRef{i:02d}")
        event = AuditEvent(
            actor_id=user.id, action="browser_created", outcome="reported",
            reason="browser_reported", resource_type="zone", resource_id=reference,
            session_id=f"SafeEventRef{i:02d}", request_id=f"Request.Event:{i:02d}",
            created_at=start + timedelta(minutes=i),
        )
        db.add(event)
        db.flush()
        ids.append(str(event.id))
    # Missing/deleted actors must survive search and keep their public fallback.
    db.add(AuditEvent(actor_id=None, action="file_upload", outcome="success",
                      resource_type="file", created_at=start))
    # All of these contain a marker that must never be searchable or displayed.
    add_session(db, admin, start, id="private_marker token")
    add_session(db, admin, start, id="session_marker\n")
    db.add(AuditEvent(actor_id=admin.id, action="private_marker action", outcome="private_marker!",
                      reason="private_marker secret", resource_type="private_marker secret",
                      session_id="private_marker token", request_id="private_marker secret",
                      created_at=start))
    db.add(AuditEvent(actor_id=admin.id, action="newline_marker\n", outcome="success",
                      reason="reason_marker\n", resource_type="resource_marker\n",
                      request_id="request_marker\n", session_id="session_marker\n",
                      created_at=start))
    db.commit()

    selection = dict(user_id=str(user.id), start="2030-02-02T00:00:00Z", end="2030-02-03T00:00:00Z")
    for q in ["EVENT SEARCH", "search-events@", "Record created", "ZONE MASTER",
              "Browser-reported", "browser_created", "reported", "zone", str(reference)]:
        first = api.get(f"{BASE}/events", headers=headers, params={**selection, "q": q, "limit": 25}).json()
        second = api.get(f"{BASE}/events", headers=headers, params={**selection, "q": q, "limit": 25, "offset": 25}).json()
        assert first["has_more"] and not second["has_more"]
        assert [row["id"] for row in first["items"] + second["items"]] == list(reversed(ids))
        exported = api.get(f"{BASE}/events/export", headers=headers, params={**selection, "q": q}).json()
        assert exported["row_count"] == 28
        assert all(row[-1] == "Browser-reported" for row in exported["rows"])
        assert str(reference) not in str(exported)
    for q in ["SafeEventRef27", "request.event:27"]:
        rows = api.get(f"{BASE}/events", headers=headers, params={**selection, "q": q}).json()["items"]
        assert [row["id"] for row in rows] == [ids[27]]
        assert api.get(f"{BASE}/events/export", headers=headers, params={**selection, "q": q}).json()["row_count"] == 1
    for q in ["%", "private_marker", "newline_marker", "reason_marker", "resource_marker",
              "request_marker", "session_marker"]:
        assert api.get(f"{BASE}/events", headers=headers, params={"q": q}).json()["items"] == []
        assert api.get(f"{BASE}/events/export", headers=headers, params={"q": q}).json()["row_count"] == 0
    # '_' is literal, not a wildcard: only actual underscores may match.
    assert api.get(f"{BASE}/events", headers=headers, params={**selection, "q": "SafeEventRef_"}).json()["items"] == []
    for q in ["Unknown/System", "Server-recorded", "file_upload"]:
        result = api.get(f"{BASE}/events", headers=headers, params={"q": q, "start": selection["start"], "end": selection["end"]}).json()
        assert any(row["user"] is None for row in result["items"])
    assert api.get(f"{BASE}/events", headers=headers, params={**selection, "user_id": str(admin.id), "q": "Record created"}).json()["items"] == []
    assert api.get(f"{BASE}/events", headers=headers, params={**selection, "end": "2030-02-02T00:01:00Z", "q": "Record created"}).json()["items"][0]["id"] == ids[0]
    for resource in ["events", "events/export"]:
        assert api.get(f"{BASE}/{resource}", headers=headers, params={"q": "x" * 101}).status_code == 422


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
    for resource in ["summary", "users", "sessions", "events", "sessions/export", "events/export"]:
        assert api.get(f"{BASE}/{resource}", headers=headers).status_code == 401

def test_exports_match_user_and_exclusive_utc_filters_without_identifiers(client):
    from app.repositories.report_exports import SESSION_COLUMNS, EVENT_COLUMNS
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    other = create_user(db, "other-export@example.com")
    start = datetime(2030, 2, 2, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    for user in [admin, other]:
        for time in [start - timedelta(seconds=1), start, end]:
            session = add_session(db, user, time, created_at=time, expires_at=end + timedelta(days=1))
            for browser in [False, True]:
                db.add(AuditEvent(
                    actor_id=user.id, action="browser_created" if browser else "file_upload",
                    outcome="reported" if browser else "success", created_at=time,
                    reason="browser_reported" if browser else None, resource_type="patient",
                    session_id=session.id, request_id="PRIVATE_REQUEST_REFERENCE",
                    resource_id=uuid.uuid4(),
                ))
    db.commit()
    query = f"?user_id={admin.id}&start=2030-02-02T00:00:00Z&end=2030-02-03T00:00:00Z"
    for resource, columns, count in [("sessions", SESSION_COLUMNS, 1), ("events", EVENT_COLUMNS, 2)]:
        displayed = api.get(f"{BASE}/{resource}{query}", headers=headers).json()
        response = api.get(f"{BASE}/{resource}/export{query}", headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["columns"] == columns and body["limit"] == 5000
        assert body["row_count"] == len(body["rows"]) == len(displayed["items"]) == count
        assert all(len(row) == len(columns) for row in body["rows"])
        for forbidden in ["PRIVATE", str(admin.id), str(other.id), "session_id", "resource_id",
                          "actor_id", "password", "token", "family_id"]:
            assert forbidden not in response.text
    assert {row[-1] for row in body["rows"]} == {"Browser-reported", "Server-recorded"}
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

@pytest.mark.parametrize("reason", [
    "new_login", "logout", "password_change", "identity_change", "identity_invalid", "replay",
])
def test_session_reason_uses_real_revocation_writer_without_changing_history(client, reason):
    from app.repositories.sessions import revoke_session
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    user = create_user(db, f"reason-{reason}@example.com")
    session = add_session(db, user, utcnow())
    assert revoke_session(db, session, reason, "safe-test-request")
    # Repeated revocation must not replace the original cause.
    assert not revoke_session(db, session, "logout", "safe-repeat-request")
    db.commit()
    before = db.scalar(select(func.count(AuditEvent.id)))
    response = api.get(f"{BASE}/sessions?user_id={user.id}&state=REVOKED&limit=1", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["revocation_reason"] == reason
    assert body["items"][0]["state"] == "REVOKED"
    assert not body["has_more"] and body["limit"] == 1
    assert db.scalar(select(func.count(AuditEvent.id))) == before
    summary = api.get(f"{BASE}/summary", headers=headers).json()
    assert summary["current_session"]["revocation_reason"] is None
@pytest.mark.parametrize("resource", ["sessions", "events"])
def test_export_overflow_and_storage_failure_never_return_partial_data(client, monkeypatch, resource):
    from app.repositories import reporting, report_exports
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    # Small cap exercises exact-boundary and overflow using real SQL.
    report = getattr(reporting, resource)
    count = len(report(db, utcnow(), "", 100, 0, None, None, None)["items"]
                if resource == "sessions"
                else report(db, 100, 0, None, None, None)["items"])
    assert count > 0
    monkeypatch.setattr(report_exports, "EXPORT_LIMIT", count)
    assert api.get(f"{BASE}/{resource}/export", headers=headers).status_code == 200
    monkeypatch.setattr(report_exports, "EXPORT_LIMIT", count - 1)
    response = api.get(f"{BASE}/{resource}/export", headers=headers)
    assert response.status_code == 409
    assert "rows" not in response.json()
    def unavailable(*args, **kwargs):
        from sqlalchemy.exc import OperationalError
        raise OperationalError("synthetic unavailable", {}, Exception("synthetic"))
    monkeypatch.setattr(reporting, resource, unavailable)
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, base_url="http://testserver", raise_server_exceptions=False) as failures:
        response = failures.get(f"{BASE}/{resource}/export", headers=headers)
    assert response.status_code == 500 and "rows" not in response.json()

@pytest.mark.parametrize("resource", ["sessions", "events"])
def test_export_invalid_filters_and_empty_matches(client, resource):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for query in ["user_id=bad", "start=2030-02-03T00:00:00Z&end=2030-02-02T00:00:00Z",
                  "start=2030-02-02T00:00:00", "end=bad"]:
        assert api.get(f"{BASE}/{resource}/export?{query}", headers=headers).status_code == 422
    response = api.get(f"{BASE}/{resource}/export?user_id={uuid.uuid4()}", headers=headers)
    assert response.status_code == 200
    assert response.json()["rows"] == [] and response.json()["row_count"] == 0


def test_session_export_search_and_state_match_the_filtered_table(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    user = create_user(db, "filtered-export@example.com")
    now = utcnow()
    add_session(db, user, now, id="export-search-active")
    add_session(db, user, now, id="export-search-revoked",
                status="REVOKED", revoked_at=now)
    db.commit()
    for state in ["ACTIVE", "REVOKED", "EXPIRED", "INVALIDATED"]:
        query = f"?q=export-search&state={state}&user_id={user.id}"
        table = api.get(f"{BASE}/sessions{query}", headers=headers).json()
        response = api.get(f"{BASE}/sessions/export{query}", headers=headers)
        assert response.status_code == 200, response.text
        exported = response.json()
        assert exported["row_count"] == len(table["items"])
        assert [row[3] for row in exported["rows"]] == [row["state"] for row in table["items"]]
        assert "export-search" not in response.text
    for query in ["state=bad", f"q={'x' * 101}"]:
        assert api.get(f"{BASE}/sessions/export?{query}", headers=headers).status_code == 422

def test_index_candidates_match_original_projection_and_do_not_match_across_fields(client):
    from app.repositories import reporting
    from app.repositories.report_labels import BROWSER_ACTIONS, RESOURCE_NAMES
    api, db, _ = client
    _headers, _admin = admin_headers(api, db)
    actor = create_user(db, "candidate-actor@example.test")
    actor.username = "Record created"  # same row matches raw, alias AND actor branches
    start = datetime(2031, 1, 1, tzinfo=timezone.utc)
    actions = list(BROWSER_ACTIONS) + ["login_success", "unsafe action!", "unavailable"]
    resources = list(RESOURCE_NAMES)
    missing = uuid.uuid4()
    for i in range(180):
        db.add(AuditEvent(
            id=uuid.UUID(int=i + 1), created_at=start + timedelta(seconds=i // 3),
            actor_id=[actor.id, None, missing][i % 3],
            action=actions[i % len(actions)], outcome="success",
            resource_type=resources[i % len(resources)],
            reason=["browser_reported", None, "private marker!"][i % 3],
            request_id=["Literal._:%/x", "unsafe marker!", "Unicode_needle"][i % 3],
        ))
    db.commit()
    for q in [
        *BROWSER_ACTIONS.values(), *RESOURCE_NAMES.values(),
        "Record created", "Unknown/System", "Server-recorded", "Browser-reported",
        "unavailable", "success", "Literal._:", "Literal._:%/x", "Unicode_needle",
        "private marker", "unsafe marker", "login_success|success",
        "%", "_", "/", "\\", "İ", "不存在", "a",
    ]:
        for actor_id, end in [(None, None), (actor.id, start + timedelta(seconds=40)),
                              (missing, None)]:
            base = select(AuditEvent.id).outerjoin(User, User.id == AuditEvent.actor_id)
            oracle = reporting.filtered(
                base, AuditEvent.actor_id, AuditEvent.created_at, actor_id, start, end,
            ).where(reporting.event_search(q)).order_by(AuditEvent.id.desc())
            expected = list(db.scalars(oracle))
            for offset in [0, 7, 25]:
                result = reporting.events(db, 7, offset, actor_id, start, end, q)
                assert [r["id"] for r in result["items"]] == expected[offset:offset + 7], q
                assert result["has_more"] == (len(expected) > offset + 7), q

def test_session_reasons_ignore_untrusted_events_and_fail_closed_for_legacy_text(client):
    api, db, _ = client
    headers, admin = admin_headers(api, db)
    user = create_user(db, "safe-reason-projection@example.com")
    now = utcnow()
    cases = ["missing", "unsafe", "unknown", "null", "first", "active", "expired", "invalidated"]
    rows = {}
    for name in cases:
        overrides = {"id": f"Reason-{name}", "created_at": now}
        if name not in {"active", "expired", "invalidated"}:
            overrides.update(status="REVOKED", revoked_at=now)
        elif name == "expired":
            overrides["created_at"] = now - timedelta(days=1)
            overrides["expires_at"] = now - timedelta(seconds=1)
        elif name == "invalidated":
            overrides["token_version"] = user.token_version + 1
        rows[name] = add_session(db, user, now, **overrides)
    def add_event(name, reason, sequence, **overrides):
        values = dict(
            id=uuid.UUID(int=sequence), actor_id=user.id, session_id=rows[name].id,
            action="session_revoked", outcome="success", reason=reason, created_at=now,
        )
        values.update(overrides)
        db.add(AuditEvent(**values))
    # These must not explain a missing transition.
    add_event("missing", "logout", 1, action="refresh_revoked")
    add_event("missing", "logout", 2, outcome="failure")
    add_event("missing", "logout", 3, actor_id=admin.id)
    add_event("missing", "browser_reported", 4, action="browser_updated", outcome="reported")
    add_event("unsafe", "password=NEVER_ECHO_CREDENTIAL", 5)
    add_event("unknown", "secret_looks_like_a_safe_literal", 6)
    add_event("null", None, 7)
    add_event("first", "new_login", 8)
    add_event("first", "logout", 9)  # same timestamp; ID breaks ties deterministically
    add_event("first", "replay", 10, created_at=now + timedelta(seconds=1))
    for i, name in enumerate(["active", "expired", "invalidated"], 11):
        add_event(name, "logout", i)
    # Do not skip an unsafe first event to invent a later recognized cause.
    add_event("unsafe", "logout", 14, created_at=now + timedelta(seconds=1))
    db.commit()
    before = db.scalar(select(func.count(AuditEvent.id)))
    pages = [
        api.get(f"{BASE}/sessions?user_id={user.id}&limit=3&offset={offset}", headers=headers)
        for offset in [0, 3, 6]
    ]
    assert all(response.status_code == 200 for response in pages)
    assert [response.json()["has_more"] for response in pages] == [True, True, False]
    items = [row for response in pages for row in response.json()["items"]]
    assert len(items) == len(cases) and len({row["id"] for row in items}) == len(cases)
    assert {row["id"]: row["revocation_reason"] for row in items} == {
        rows[name].id: "new_login" if name == "first" else None for name in cases
    }
    assert db.scalar(select(func.count(AuditEvent.id))) == before
    for response in pages:
        for forbidden in ["NEVER_ECHO_CREDENTIAL", "secret_looks", "password_hash",
                          "token_hash", "family_id", "token_version", "identity_version"]:
            assert forbidden not in response.text

def test_search_real_export_ceiling_and_maximum_offset_with_overlapping_matches(client):
    from sqlalchemy import insert
    api, db, _ = client
    headers, _admin = admin_headers(api, db)
    actor = create_user(db, "ceiling-actor@example.test")
    actor.username = "Record created"
    start = datetime(2032, 1, 1, tzinfo=timezone.utc)
    db.execute(insert(AuditEvent), [
        dict(id=uuid.UUID(int=i + 1), actor_id=actor.id, action="browser_created",
             outcome="reported", reason="browser_reported", resource_type="patient",
             request_id="ceiling_probe" if i < 5001 else "other_probe", created_at=start)
        for i in range(10040)
    ])
    db.commit()
    page = api.get(f"{BASE}/events", headers=headers,
                   params={"q": "Record created", "start": start.isoformat(),
                           "offset": 10000, "limit": 25}).json()
    assert [row["id"] for row in page["items"]] == [
        str(uuid.UUID(int=i)) for i in range(40, 15, -1)
    ]
    assert page["has_more"]
    params = {"q": "ceiling_probe", "start": start.isoformat()}
    overflow = api.get(f"{BASE}/events/export", headers=headers, params=params)
    assert overflow.status_code == 409 and "rows" not in overflow.json()
    db.get(AuditEvent, uuid.UUID(int=1)).request_id = "other_probe"
    db.commit()
    exact = api.get(f"{BASE}/events/export", headers=headers, params=params)
    assert exact.status_code == 200
    assert exact.json()["row_count"] == exact.json()["limit"] == 5000
    assert len(exact.json()["rows"]) == 5000
