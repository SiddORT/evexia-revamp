"""Authentication session lifecycle and access-token binding regressions."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password, token_digest, utcnow
from app.db.models import AuditEvent, AuthSession, MRProfile, RefreshSession, User
from app.db.session import get_db, session_factory
from app.main import app
from app.services import auth as auth_service

PASSWORD = "correct horse battery staple"


@pytest.fixture
def client():
    # API commits are isolated by an outer transaction in these non-concurrency tests.
    if get_settings().app_env == "production":
        pytest.fail("Session tests refuse to connect with APP_ENV=production")
    connection = session_factory().kw["bind"].connect()
    outer = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    settings = get_settings()

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app, base_url="http://testserver") as test_client:
            yield test_client, db, settings
    finally:
        app.dependency_overrides.clear()
        db.close()
        outer.rollback()
        connection.close()


def create_user(db, email):
    user = User(
        email=email, username=email.split("@")[0], password_hash=hash_password(PASSWORD),
        system_role="mr", identity_version=1,
    )
    db.add(user)
    db.flush()
    db.add(MRProfile(user_id=user.id, is_active=True))
    db.commit()
    return user


def login(api, email):
    return api.post(
        "/api/v1/auth/login", headers={"Origin": "http://testserver"},
        json={"identifier": email, "password": PASSWORD},
    )


def session_id_from_response(response, token):
    claims = jwt.decode(token, options={"verify_signature": False})
    assert isinstance(claims["sid"], str) and claims["sid"]
    return claims["sid"]


def page_rows(body):
    if isinstance(body, list):
        return body
    for key in ("items", "sessions", "results"):
        if key in body:
            return body[key]
    raise AssertionError(f"Unexpected session-list response fields: {sorted(body)}")


def session_identifier(row):
    return row.get("session_id", row.get("id"))


def test_login_and_refresh_tokens_are_bound_to_opaque_session_id(client):
    api, db, _ = client
    user = create_user(db, "opaque-session@example.com")
    first = login(api, user.email)
    assert first.status_code == 200, first.text
    first_sid = session_id_from_response(first, first.json()["access_token"])
    # Session identifiers are public opaque strings, not UUID/refresh-family IDs.
    assert not _looks_like_uuid(first_sid)

    session = db.get(AuthSession, first_sid)
    assert session is not None and session.user_id == user.id
    refresh = db.scalar(select(RefreshSession).where(RefreshSession.session_id == first_sid))
    assert refresh is not None

    rotated = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert rotated.status_code == 200, rotated.text
    assert session_id_from_response(rotated, rotated.json()["access_token"]) == first_sid
    history = list(db.scalars(select(RefreshSession).where(
        RefreshSession.session_id == first_sid,
    )))
    assert len(history) == 2
    assert sum(row.consumed_at is None and row.revoked_at is None for row in history) == 1
    assert sum(row.consumed_at is not None for row in history) == 1


def test_new_login_replaces_only_same_users_valid_session_and_preserves_history(client):
    api, db, _ = client
    owner = create_user(db, "replacement-owner@example.com")
    other = create_user(db, "replacement-other@example.com")
    first = login(api, owner.email)
    access = first.json()["access_token"]
    sid = session_id_from_response(first, access)
    cookie = api.cookies.get("evexia_refresh")
    api.cookies.clear()
    foreign = login(api, other.email)
    foreign_access = foreign.json()["access_token"]
    foreign_sid = session_id_from_response(foreign, foreign_access)
    api.cookies.clear()
    bad = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
                   json={"identifier": owner.email, "password": "wrong password"})
    assert bad.status_code == 401
    assert db.get(AuthSession, sid).status == "ACTIVE"
    latest = login(api, owner.email)
    assert latest.status_code == 200
    new_sid = session_id_from_response(latest, latest.json()["access_token"])
    assert new_sid != sid
    assert db.get(AuthSession, sid).status == "REVOKED"
    assert db.get(AuthSession, new_sid).status == "ACTIVE"
    assert db.get(AuthSession, foreign_sid).status == "ACTIVE"
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {foreign_access}"}).status_code == 200
    api.cookies.set("evexia_refresh", cookie, path="/api/v1/auth")
    assert api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"}).status_code == 401
    assert all(row.revoked_at is not None for row in db.scalars(
        select(RefreshSession).where(RefreshSession.session_id == sid)))
    assert db.scalar(select(AuditEvent).where(
        AuditEvent.session_id == sid, AuditEvent.action == "session_revoked",
        AuditEvent.reason == "new_login")) is not None

    # An old but already-expired row is historical expiry, not a fresh replacement.
    db.get(AuthSession, new_sid).created_at = utcnow() - timedelta(hours=1)
    db.get(AuthSession, new_sid).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    again = login(api, owner.email)
    assert again.status_code == 200
    assert db.get(AuthSession, new_sid).status == "EXPIRED"
    assert db.scalar(select(AuditEvent).where(
        AuditEvent.session_id == new_sid, AuditEvent.reason == "new_login")) is None


def test_parallel_successful_logins_leave_one_active_session():
    if get_settings().app_env == "production":
        pytest.fail("Session concurrency tests refuse to connect with APP_ENV=production")
    engine = session_factory().kw["bind"]
    settings = get_settings()
    user_id = uuid.uuid4()
    email = f"parallel-login-{user_id.hex}@example.com"
    with Session(engine) as db:
        db.add(User(id=user_id, email=email, username=f"pl{user_id.hex[:20]}",
                    password_hash=hash_password(PASSWORD), system_role="mr", identity_version=1))
        db.flush()
        db.add(MRProfile(user_id=user_id, is_active=True))
        db.commit()
    gate = Barrier(2)

    def attempt():
        with Session(engine) as db:
            gate.wait(timeout=10)
            identity, raw = auth_service.login(db, email, PASSWORD, settings, False,
                                               f"parallel-login-{uuid.uuid4().hex}", "127.0.0.1")
            return identity.session_id, raw

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        with Session(engine) as db:
            rows = list(db.scalars(select(AuthSession).where(AuthSession.user_id == user_id)))
            assert len(rows) == 2
            assert sorted(s.status for s in rows) == ["ACTIVE", "REVOKED"]
            active = next(s for s in rows if s.status == "ACTIVE")
            for sid, raw in results:
                if sid != active.id:
                    with pytest.raises(auth_service.AuthError):
                        auth_service.rotate_refresh(db, raw, settings, "parallel-login-check")
            assert db.scalar(select(AuditEvent).where(
                AuditEvent.session_id != active.id, AuditEvent.actor_id == user_id,
                AuditEvent.reason == "new_login")) is not None
    finally:
        with Session(engine) as db:
            ids = list(db.scalars(select(AuthSession.id).where(AuthSession.user_id == user_id)))
            db.execute(delete(AuditEvent).where(AuditEvent.actor_id == user_id))
            db.execute(update(RefreshSession).where(RefreshSession.session_id.in_(ids)).values(replaced_by_id=None))
            db.execute(delete(RefreshSession).where(RefreshSession.session_id.in_(ids)))
            db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
            db.execute(delete(MRProfile).where(MRProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def _looks_like_uuid(value):
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def test_session_read_and_paginated_list_are_limited_to_authenticated_owner(client):
    api, db, _ = client
    owner = create_user(db, "owner-sessions@example.com")
    other = create_user(db, "other-sessions@example.com")
    own_ids = []
    for _ in range(3):
        response = login(api, owner.email)
        assert response.status_code == 200
        own_ids.append(session_id_from_response(response, response.json()["access_token"]))
    foreign = login(api, other.email)
    assert foreign.status_code == 200
    foreign_id = session_id_from_response(foreign, foreign.json()["access_token"])

    api.cookies.clear()
    current_response = login(api, owner.email)
    assert current_response.status_code == 200
    owner_token = current_response.json()["access_token"]
    current_id = session_id_from_response(current_response, owner_token)
    # The token's session is readable at the self endpoint; foreign IDs are never returned.
    current = api.get(
        "/api/v1/auth/session", headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert current.status_code == 200, current.text
    assert session_identifier(current.json()) == current_id
    listing = api.get(
        "/api/v1/auth/sessions?limit=2&offset=1",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert listing.status_code == 200, listing.text
    rows = page_rows(listing.json())
    assert len(rows) == 2
    assert foreign_id not in {session_identifier(row) for row in rows}
    all_rows = api.get(
        "/api/v1/auth/sessions?limit=100&offset=0",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert all_rows.status_code == 200, all_rows.text
    all_row_ids = [session_identifier(row) for row in page_rows(all_rows.json())]
    all_ids = set(all_row_ids)
    assert current_id in all_ids
    assert foreign_id not in all_ids
    assert all_ids.issubset(set(own_ids) | {current_id})
    assert [session_identifier(row) for row in rows] == all_row_ids[1:3]


@pytest.mark.parametrize("invalidator", ["revoked", "expired", "identity_version"])
def test_access_jwt_rejects_revoked_expired_or_identity_changed_session(client, invalidator):
    api, db, _ = client
    user = create_user(db, f"invalid-{invalidator}@example.com")
    response = login(api, user.email)
    assert response.status_code == 200
    token = response.json()["access_token"]
    sid = session_id_from_response(response, token)
    auth_session = db.get(AuthSession, sid)
    assert auth_session is not None

    if invalidator == "revoked":
        auth_session.revoked_at = utcnow()
        auth_session.status = "REVOKED"
    elif invalidator == "expired":
        auth_session.created_at = utcnow() - timedelta(hours=1)
        auth_session.expires_at = utcnow() - timedelta(seconds=1)
    else:
        user.identity_version += 1
    db.flush()
    denial = api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"},
    )
    assert denial.status_code == 401
    assert "x-session-reason" not in denial.headers


def test_replaced_credentials_return_only_safe_hint_and_remain_revoked(client):
    api, db, _ = client
    user = create_user(db, "replacement-notice@example.com")
    first = login(api, user.email)
    old_token = first.json()["access_token"]
    old_cookie = api.cookies.get("evexia_refresh")
    old_sid = session_id_from_response(first, old_token)
    second = login(api, user.email)
    new_token = second.json()["access_token"]
    new_sid = session_id_from_response(second, new_token)
    denial = api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old_token}"})
    assert denial.status_code == 401
    assert denial.headers["x-session-reason"] == "replaced"
    assert user.email not in denial.text and old_sid not in denial.text and new_sid not in denial.text
    assert denial.headers["cache-control"] == "no-store"
    api.cookies.clear()
    api.cookies.set("evexia_refresh", old_cookie, path="/api/v1/auth")
    for _ in range(2):
        rejected = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
        assert rejected.status_code == 401
        assert rejected.headers["x-session-reason"] == "replaced"
        assert "access_token" not in rejected.json()
        api.cookies.set("evexia_refresh", old_cookie, path="/api/v1/auth")
    assert db.get(AuthSession, old_sid).status == "REVOKED"
    assert db.get(AuthSession, new_sid).status == "ACTIVE"
    assert api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200
    # A subsequent security change suppresses the old replacement explanation.
    user.token_version += 1
    db.flush()
    assert "x-session-reason" not in api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {old_token}"},
    ).headers
    rejected = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert rejected.status_code == 401
    assert "x-session-reason" not in rejected.headers


def test_replayed_refresh_token_revokes_its_session_and_all_refresh_history(client):
    api, db, _ = client
    user = create_user(db, "replay-session@example.com")
    first = login(api, user.email)
    assert first.status_code == 200
    sid = session_id_from_response(first, first.json()["access_token"])
    original_cookie = api.cookies.get("evexia_refresh")

    rotated = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert rotated.status_code == 200
    api.cookies.set("evexia_refresh", original_cookie, path="/api/v1/auth")
    replay = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert replay.status_code == 401
    auth_session = db.get(AuthSession, sid)
    assert auth_session.revoked_at is not None
    history = list(db.scalars(select(RefreshSession).where(RefreshSession.session_id == sid)))
    assert len(history) == 2
    assert all(row.revoked_at is not None for row in history)
    assert any(row.consumed_at is not None for row in history)


def test_parallel_refresh_replay_uses_independent_committed_connections():
    """Two real PostgreSQL transactions race for one refresh row (no SAVEPOINT fixture)."""
    if get_settings().app_env == "production":
        pytest.fail("Session concurrency tests refuse to connect with APP_ENV=production")
    settings = get_settings()
    engine = session_factory().kw["bind"]
    user_id = uuid.uuid4()
    raw_refresh = None
    sid = None
    # Create fixture data in a standalone committed connection before racing.
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id=user_id, email=f"concurrent-{user_id.hex}@example.com",
            username=f"c{user_id.hex[:20]}", password_hash=hash_password(PASSWORD),
            system_role="mr", identity_version=1,
        )
        db.add(user)
        db.flush()
        mr = MRProfile(user_id=user.id, is_active=True)
        db.add(mr)
        db.flush()
        _, raw_refresh = auth_service.login(
            db, user.email, PASSWORD, settings, False, "parallel-refresh-setup", "127.0.0.1",
        )
        row = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == token_digest(raw_refresh),
        ))
        sid = row.session_id
        db.commit()

    gate = Barrier(2)

    def consume():
        with Session(engine, expire_on_commit=False) as db:
            gate.wait(timeout=10)
            try:
                auth_service.rotate_refresh(db, raw_refresh, settings, f"parallel-{uuid.uuid4().hex}")
                return "rotated"
            except auth_service.AuthError:
                return "rejected"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: consume(), range(2)))
        assert sorted(outcomes) == ["rejected", "rotated"]
        with Session(engine) as db:
            session = db.get(AuthSession, sid)
            history = list(db.scalars(select(RefreshSession).where(
                RefreshSession.session_id == sid,
            )))
            assert session.revoked_at is not None
            assert len(history) == 2
            assert all(row.revoked_at is not None for row in history)
            assert any(row.consumed_at is not None for row in history)
    finally:
        with Session(engine) as db:
            db.execute(delete(AuditEvent).where(AuditEvent.session_id == sid))
            db.execute(update(RefreshSession).where(RefreshSession.session_id == sid).values(replaced_by_id=None))
            db.execute(delete(RefreshSession).where(RefreshSession.session_id == sid))
            db.execute(delete(AuthSession).where(AuthSession.id == sid))
            db.execute(delete(MRProfile).where(MRProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def test_refresh_racing_sign_out_cannot_leave_a_successor_usable():
    """An old cookie still revokes its session if rotation wins the lock first."""
    if get_settings().app_env == "production":
        pytest.fail("Session concurrency tests refuse to connect with APP_ENV=production")
    settings = get_settings()
    engine = session_factory().kw["bind"]
    user_id = uuid.uuid4()
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id=user_id, email=f"logout-race-{user_id.hex}@example.com",
            username=f"l{user_id.hex[:20]}", password_hash=hash_password(PASSWORD),
            system_role="mr", identity_version=1,
        )
        db.add(user)
        db.flush()
        db.add(MRProfile(user_id=user_id, is_active=True))
        db.flush()
        _, raw = auth_service.login(db, user.email, PASSWORD, settings, False, "logout-race-setup", "127.0.0.1")
        sid = db.scalar(select(RefreshSession.session_id).where(RefreshSession.token_hash == token_digest(raw)))
    gate = Barrier(2)

    def refresh():
        with Session(engine) as db:
            gate.wait(timeout=10)
            try:
                _, successor = auth_service.rotate_refresh(db, raw, settings, "logout-race-refresh")
                return successor
            except auth_service.AuthError:
                return None

    def sign_out():
        with Session(engine) as db:
            gate.wait(timeout=10)
            auth_service.logout(db, raw, "logout-race-signout")

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            refresh_future = pool.submit(refresh)
            logout_future = pool.submit(sign_out)
            successor = refresh_future.result(timeout=20)
            logout_future.result(timeout=20)
        with Session(engine) as db:
            assert db.get(AuthSession, sid).status == "REVOKED"
            history = list(db.scalars(select(RefreshSession).where(
                RefreshSession.session_id == sid,
            )))
            assert history and all(row.revoked_at is not None for row in history)
            if successor:
                with pytest.raises(auth_service.AuthError):
                    auth_service.rotate_refresh(db, successor, settings, "logout-race-check")
    finally:
        with Session(engine) as db:
            db.execute(delete(AuditEvent).where(AuditEvent.session_id == sid))
            db.execute(delete(AuditEvent).where(AuditEvent.actor_id == user_id))
            db.execute(update(RefreshSession).where(RefreshSession.session_id == sid).values(replaced_by_id=None))
            db.execute(delete(RefreshSession).where(RefreshSession.session_id == sid))
            db.execute(delete(AuthSession).where(AuthSession.id == sid))
            db.execute(delete(MRProfile).where(MRProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def test_two_concurrent_logout_transactions_terminate_once_without_log_flood():
    """Competing sign-outs use independent PostgreSQL connections and row locks."""
    if get_settings().app_env == "production":
        pytest.fail("Session concurrency tests refuse to connect with APP_ENV=production")
    settings = get_settings()
    engine = session_factory().kw["bind"]
    user_id = uuid.uuid4()
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id=user_id, email=f"concurrent-logout-{user_id.hex}@example.com",
            username=f"cl{user_id.hex[:20]}", password_hash=hash_password(PASSWORD),
            system_role="mr", identity_version=1,
        )
        db.add(user)
        db.flush()
        db.add(MRProfile(user_id=user.id, is_active=True))
        db.flush()
        _, raw = auth_service.login(
            db, user.email, PASSWORD, settings, False, "concurrent-logout-setup", "127.0.0.1",
        )
        sid = db.scalar(select(RefreshSession.session_id).where(
            RefreshSession.token_hash == token_digest(raw),
        ))

    gate = Barrier(2)

    def sign_out(request_id):
        with Session(engine, expire_on_commit=False) as db:
            gate.wait(timeout=10)
            auth_service.logout(db, raw, request_id)
            return request_id

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(sign_out, ("concurrent-logout-one", "concurrent-logout-two")))
        assert len(results) == 2
        with Session(engine) as db:
            session = db.get(AuthSession, sid)
            history = list(db.scalars(select(RefreshSession).where(
                RefreshSession.session_id == sid,
            )))
            logout_events = list(db.scalars(select(AuditEvent).where(
                AuditEvent.action == "logout", AuditEvent.session_id == sid,
            )))
            assert session.status == "REVOKED"
            assert history and all(row.revoked_at is not None for row in history)
            assert len(logout_events) == 1
            assert logout_events[0].actor_id == user_id
            assert logout_events[0].request_id in results
    finally:
        with Session(engine) as db:
            db.execute(delete(AuditEvent).where(AuditEvent.session_id == sid))
            db.execute(update(RefreshSession).where(
                RefreshSession.session_id == sid,
            ).values(replaced_by_id=None))
            db.execute(delete(RefreshSession).where(RefreshSession.session_id == sid))
            db.execute(delete(AuthSession).where(AuthSession.id == sid))
            db.execute(delete(MRProfile).where(MRProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def _signed_claim_variant(token, settings, *, algorithm="HS256", **updates):
    claims = jwt.decode(token, options={"verify_signature": False})
    for key, value in updates.items():
        if value is None:
            claims.pop(key, None)
        else:
            claims[key] = value
    return jwt.encode(claims, settings.signing_key, algorithm=algorithm)


def test_signed_access_token_cannot_substitute_another_mrs_session_id(client):
    api, db, settings = client
    first_user = create_user(db, "sid-owner@example.com")
    second_user = create_user(db, "sid-other-mr@example.com")
    first = login(api, first_user.email)
    second = login(api, second_user.email)
    assert first.status_code == second.status_code == 200
    first_token = first.json()["access_token"]
    second_sid = session_id_from_response(second, second.json()["access_token"])
    substituted = _signed_claim_variant(first_token, settings, sid=second_sid)

    response = api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {substituted}"})
    assert response.status_code == 401


def test_mr_identity_has_no_super_admin_permissions_or_domain_access(client):
    api, db, _ = client
    user = create_user(db, "ordinary-mr@example.com")
    response = login(api, user.email)
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["system_role"] == "mr"
    assert me.json()["permissions"] == []

    provision = api.post(
        "/api/v1/domain/mrs",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "another-mr@example.com", "username": "another-mr",
            "password": "another secure password",
        },
    )
    assert provision.status_code == 403


@pytest.mark.parametrize(
    ("claim", "value", "algorithm"),
    [
        ("sid", None, "HS256"),
        ("sid", 12345, "HS256"),
        ("iss", "untrusted-issuer", "HS256"),
        ("aud", "untrusted-audience", "HS256"),
        ("exp", 1, "HS256"),
        ("iss", "evexia", "HS384"),
    ],
)
def test_access_jwt_rejects_missing_malformed_or_untrusted_claims(
    client, claim, value, algorithm,
):
    api, db, settings = client
    user = create_user(db, f"jwt-claims-{claim}-{algorithm.lower()}@example.com")
    response = login(api, user.email)
    assert response.status_code == 200
    token = _signed_claim_variant(
        response.json()["access_token"], settings, algorithm=algorithm, **{claim: value},
    )

    rejected = api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert rejected.status_code == 401


@pytest.mark.parametrize("disabled", ["user", "mr"])
def test_disabled_user_or_mr_cannot_use_existing_access_token(client, disabled):
    api, db, _ = client
    user = create_user(db, f"disabled-{disabled}@example.com")
    response = login(api, user.email)
    assert response.status_code == 200
    token = response.json()["access_token"]
    if disabled == "user":
        user.is_active = False
    else:
        profile = db.scalar(select(MRProfile).where(MRProfile.user_id == user.id))
        profile.is_active = False
    db.flush()

    rejected = api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert rejected.status_code == 401


def test_session_expiry_emits_only_one_expiry_event(client):
    api, db, _ = client
    user = create_user(db, "expiry-event@example.com")
    response = login(api, user.email)
    assert response.status_code == 200
    token = response.json()["access_token"]
    sid = session_id_from_response(response, token)
    session = db.get(AuthSession, sid)
    session.created_at = utcnow() - timedelta(hours=1)
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()
    headers = {"Authorization": f"Bearer {token}"}

    assert api.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert api.get("/api/v1/auth/me", headers=headers).status_code == 401
    events = list(db.scalars(select(AuditEvent).where(
        AuditEvent.action == "session_expired", AuditEvent.session_id == sid,
    )))
    assert len(events) == 1
    assert db.get(AuthSession, sid).status == "EXPIRED"


def test_independent_sessions_revoke_independently(client):
    api, db, _ = client
    user = create_user(db, "independent-sessions@example.com")
    first = login(api, user.email)
    assert first.status_code == 200
    first_token = first.json()["access_token"]
    first_sid = session_id_from_response(first, first_token)
    first_cookie = api.cookies.get("evexia_refresh")

    api.cookies.clear()
    second = login(api, user.email)
    assert second.status_code == 200
    second_token = second.json()["access_token"]
    second_sid = session_id_from_response(second, second_token)
    assert second_sid != first_sid

    api.cookies.set("evexia_refresh", first_cookie, path="/api/v1/auth")
    assert api.post(
        "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
    ).status_code == 204
    assert api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {first_token}"},
    ).status_code == 401
    still_valid = api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {second_token}"},
    )
    assert still_valid.status_code == 200, still_valid.text
    assert db.get(AuthSession, second_sid).status == "ACTIVE"


@pytest.mark.parametrize("role", ["mr", "super_admin"])
def test_logout_uses_the_common_cookie_session_termination_for_each_role(client, role, caplog):
    api, db, settings = client
    if role == "super_admin":
        from pydantic import SecretStr
        from app.bootstrap import bootstrap_super_admin

        user_id = bootstrap_super_admin(db, SecretStr(PASSWORD)).user_id
        user = db.get(User, user_id)
    else:
        user = create_user(db, "logout-current-mr@example.com")

    signed_in = login(api, user.email)
    assert signed_in.status_code == 200, signed_in.text
    access = signed_in.json()["access_token"]
    sid = session_id_from_response(signed_in, access)
    raw_refresh = api.cookies.get("evexia_refresh")
    assert raw_refresh

    response = api.post(
        "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 204
    assert response.content == b""
    assert db.get(AuthSession, sid).status == "REVOKED"
    assert api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"},
    ).status_code == 401

    credentials = list(db.scalars(select(RefreshSession).where(
        RefreshSession.session_id == sid,
    )))
    assert credentials and all(row.revoked_at is not None for row in credentials)
    # A captured pre-logout credential cannot rotate or mint a new access token.
    api.cookies.clear()
    api.cookies.set("evexia_refresh", raw_refresh, path="/api/v1/auth")
    rejected = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert rejected.status_code == 401
    assert db.get(AuthSession, sid).status == "REVOKED"
    assert all(row.revoked_at is not None for row in db.scalars(
        select(RefreshSession).where(RefreshSession.session_id == sid),
    ))

    event = db.scalar(select(AuditEvent).where(
        AuditEvent.action == "logout", AuditEvent.session_id == sid,
    ))
    assert event is not None
    assert event.outcome == "success"
    assert event.actor_id == user.id
    assert event.request_id
    assert raw_refresh not in str(event)
    assert raw_refresh not in caplog.text
    assert access not in caplog.text
    assert "authorization" not in caplog.text.lower()


def test_logout_ignores_client_identity_and_session_substitution_and_revokes_only_cookie_session(client):
    api, db, _ = client
    caller = create_user(db, "logout-owner@example.com")
    other_mr = create_user(db, "logout-other-mr@example.com")
    caller_first = login(api, caller.email)
    caller_first_sid = session_id_from_response(caller_first, caller_first.json()["access_token"])
    caller_cookie = api.cookies.get("evexia_refresh")

    api.cookies.clear()
    caller_second = login(api, caller.email)
    caller_second_sid = session_id_from_response(caller_second, caller_second.json()["access_token"])
    api.cookies.clear()
    foreign = login(api, other_mr.email)
    foreign_sid = session_id_from_response(foreign, foreign.json()["access_token"])
    foreign_cookie = api.cookies.get("evexia_refresh")

    # The same endpoint is used for Super Admin and MR self-logout; elevated
    # callers still cannot designate a different session.
    api.cookies.clear()
    api.cookies.set("evexia_refresh", caller_cookie, path="/api/v1/auth")
    response = api.post(
        "/api/v1/auth/logout?session_id=" + foreign_sid,
        headers={"Origin": "http://testserver"},
        json={
            "session_id": foreign_sid,
            "user_id": str(other_mr.id),
            "mr_id": str(other_mr.id),
            "email": other_mr.email,
        },
    )
    assert response.status_code == 204
    assert db.get(AuthSession, caller_first_sid).status == "REVOKED"
    assert db.get(AuthSession, caller_second_sid).status == "ACTIVE"
    assert db.get(AuthSession, foreign_sid).status == "ACTIVE"
    foreign_rows = list(db.scalars(select(RefreshSession).where(
        RefreshSession.session_id == foreign_sid,
    )))
    assert foreign_rows and all(row.revoked_at is None for row in foreign_rows)

    # An MR-provided Super Admin session identifier is equally non-authoritative.
    from pydantic import SecretStr
    from app.bootstrap import bootstrap_super_admin

    admin_id = bootstrap_super_admin(db, SecretStr(PASSWORD)).user_id
    api.cookies.clear()
    mr_again = login(api, caller.email)
    mr_sid = session_id_from_response(mr_again, mr_again.json()["access_token"])
    mr_cookie = api.cookies.get("evexia_refresh")
    api.cookies.clear()
    admin = login(api, db.get(User, admin_id).email)
    admin_sid = session_id_from_response(admin, admin.json()["access_token"])
    api.cookies.clear()
    api.cookies.set("evexia_refresh", mr_cookie, path="/api/v1/auth")
    assert api.post(
        "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
        json={"session_id": admin_sid, "user_id": str(admin_id)},
    ).status_code == 204
    assert db.get(AuthSession, mr_sid).status == "REVOKED"
    assert db.get(AuthSession, admin_sid).status == "ACTIVE"
    assert all(row.revoked_at is None for row in db.scalars(select(RefreshSession).where(
        RefreshSession.session_id == admin_sid,
    )))

    # Super Admin also has only self-logout authority at this route.
    api.cookies.clear()
    admin_again = login(api, db.get(User, admin_id).email)
    admin_again_sid = session_id_from_response(
        admin_again, admin_again.json()["access_token"],
    )
    admin_again_cookie = api.cookies.get("evexia_refresh")
    api.cookies.clear()
    api.cookies.set("evexia_refresh", admin_again_cookie, path="/api/v1/auth")
    assert api.post(
        "/api/v1/auth/logout?user_id=" + str(other_mr.id),
        headers={"Origin": "http://testserver"},
        json={"session_id": foreign_sid, "user_id": str(other_mr.id), "mr_id": str(other_mr.id)},
    ).status_code == 204
    assert db.get(AuthSession, admin_again_sid).status == "REVOKED"
    assert db.get(AuthSession, foreign_sid).status == "ACTIVE"
    assert all(row.revoked_at is None for row in db.scalars(select(RefreshSession).where(
        RefreshSession.session_id == foreign_sid,
    )))
    assert foreign_cookie


@pytest.mark.parametrize("cookie", [None, "unknown-opaque-cookie", "not a valid cookie value"])
def test_logout_without_known_refresh_credential_is_safe204_and_does_not_log(cookie, client):
    api, db, _ = client
    api.cookies.clear()
    headers = {"Origin": "http://testserver"}
    if cookie is not None:
        headers["Cookie"] = f"evexia_refresh={cookie}"
    response = api.post("/api/v1/auth/logout", headers=headers)
    assert response.status_code == 204
    assert response.content == b""
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "logout")) is None


def test_logout_repeat_revoked_and_expired_cookie_outcomes_are_idempotent(client):
    api, db, _ = client
    user = create_user(db, "logout-idempotent@example.com")
    signed_in = login(api, user.email)
    sid = session_id_from_response(signed_in, signed_in.json()["access_token"])
    raw = api.cookies.get("evexia_refresh")
    api.cookies.clear()

    for _ in range(2):
        api.cookies.set("evexia_refresh", raw, path="/api/v1/auth")
        assert api.post(
            "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
        ).status_code == 204
        api.cookies.clear()
    assert db.get(AuthSession, sid).status == "REVOKED"
    events = list(db.scalars(select(AuditEvent).where(
        AuditEvent.action == "logout", AuditEvent.session_id == sid,
    )))
    assert len(events) == 1
    assert events[0].outcome == "success"

    expired_login = login(api, user.email)
    expired_sid = session_id_from_response(expired_login, expired_login.json()["access_token"])
    expired_raw = api.cookies.get("evexia_refresh")
    expired_session = db.get(AuthSession, expired_sid)
    expired_session.created_at = utcnow() - timedelta(hours=2)
    expired_session.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()
    api.cookies.clear()
    api.cookies.set("evexia_refresh", expired_raw, path="/api/v1/auth")
    assert api.post(
        "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
    ).status_code == 204
    assert db.get(AuthSession, expired_sid).status == "REVOKED"
    expired_event = db.scalar(select(AuditEvent).where(
        AuditEvent.action == "logout", AuditEvent.session_id == expired_sid,
    ))
    assert expired_event is not None
    assert expired_event.outcome == "success"
    assert expired_event.reason == "expired"
    api.cookies.clear()
    api.cookies.set("evexia_refresh", expired_raw, path="/api/v1/auth")
    assert api.post(
        "/api/v1/auth/logout", headers={"Origin": "http://testserver"},
    ).status_code == 204
    assert len(list(db.scalars(select(AuditEvent).where(
        AuditEvent.action == "logout", AuditEvent.session_id == expired_sid,
    )))) == 1


def test_logout_records_meaningful_persisted_credential_session_mismatch_safely(client, monkeypatch):
    from types import SimpleNamespace

    api, db, _ = client
    user = create_user(db, "logout-invalid-state@example.com")
    signed_in = login(api, user.email)
    sid = session_id_from_response(signed_in, signed_in.json()["access_token"])
    raw = api.cookies.get("evexia_refresh")
    actual_get = auth_service.repository.get_credential

    def mismatched_reread(db_session, digest, lock=False):
        row = actual_get(db_session, digest, lock=lock)
        if lock and row is not None:
            return SimpleNamespace(user_id=row.user_id, session_id="different-session-id")
        return row

    monkeypatch.setattr(auth_service.repository, "get_credential", mismatched_reread)
    auth_service.logout(db, raw, "logout-invalid-state-test")
    assert db.get(AuthSession, sid).status == "ACTIVE"
    event = db.scalar(select(AuditEvent).where(
        AuditEvent.action == "logout", AuditEvent.session_id == sid,
    ))
    assert event is not None
    assert event.outcome == "failure"
    assert event.reason == "invalid_session"
    assert event.actor_id == user.id
    assert event.request_id == "logout-invalid-state-test"


def test_logout_ignores_pre_session_migration_revoked_unbound_refresh_history(client, monkeypatch):
    from types import SimpleNamespace

    _, db, _ = client
    # The migration intentionally preserves some historical, already-revoked
    # credentials without a session binding. Replaying one is an idempotent
    # no-op, not a new security failure on every request.
    legacy = SimpleNamespace(
        user_id=uuid.uuid4(), session_id=None, revoked_at=utcnow(),
    )
    monkeypatch.setattr(
        auth_service.repository, "get_credential", lambda *_args, **_kwargs: legacy,
    )
    monkeypatch.setattr(
        auth_service.repository, "lock_user",
        lambda *_args, **_kwargs: pytest.fail("unbound legacy row must not be locked"),
    )

    auth_service.logout(db, "legacy-revoked-credential", "legacy-logout-first")
    auth_service.logout(db, "legacy-revoked-credential", "legacy-logout-repeat")
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "logout")) is None


def test_logout_requires_origin_but_ignores_bearer_authentication_state(client):
    api, db, settings = client
    user = create_user(db, "logout-bearer@example.com")
    signed_in = login(api, user.email)
    sid = session_id_from_response(signed_in, signed_in.json()["access_token"])
    expired_bearer = _signed_claim_variant(
        signed_in.json()["access_token"], settings, exp=1,
    )
    raw = api.cookies.get("evexia_refresh")
    api.cookies.clear()

    denied = api.post(
        "/api/v1/auth/logout",
        headers={"Origin": "https://attacker.example", "Cookie": f"evexia_refresh={raw}"},
    )
    assert denied.status_code == 403
    assert db.get(AuthSession, sid).status == "ACTIVE"

    for bearer in ("malformed-access-token", expired_bearer):
        api.cookies.set("evexia_refresh", raw, path="/api/v1/auth")
        result = api.post(
            "/api/v1/auth/logout",
            headers={
                "Origin": "http://testserver",
                "Authorization": f"Bearer {bearer}",
            },
        )
        assert result.status_code == 204
        api.cookies.clear()
    assert db.get(AuthSession, sid).status == "REVOKED"


def test_logout_cookie_clear_preserves_development_and_host_cookie_security_attributes(client):
    api, db, settings = client
    user = create_user(db, "logout-cookie-flags@example.com")
    signed_in = login(api, user.email)
    sid = session_id_from_response(signed_in, signed_in.json()["access_token"])
    raw = api.cookies.get("evexia_refresh")
    api.cookies.clear()
    api.cookies.set("evexia_refresh", raw, path="/api/v1/auth")
    cleared = api.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"})
    assert cleared.status_code == 204
    cookie_header = cleared.headers["set-cookie"].lower()
    assert "evexia_refresh=" in cookie_header
    assert "path=/api/v1/auth" in cookie_header
    assert "httponly" in cookie_header
    assert "samesite=strict" in cookie_header
    assert "secure" not in cookie_header
    assert "max-age=0" in cookie_header or "expires=" in cookie_header

    # Production's __Host- cookie requires Secure and Path=/ with no Domain.
    production = settings.model_copy(update={"app_env": "production"})
    from app.api.v1.auth import clear_refresh_cookie
    from fastapi import Response

    host_response = Response()
    clear_refresh_cookie(host_response, production)
    host_header = host_response.headers["set-cookie"].lower()
    assert "__host-evexia_refresh=" in host_header
    assert "path=/" in host_header
    assert "secure" in host_header
    assert "httponly" in host_header
    assert "samesite=strict" in host_header
    assert "domain=" not in host_header
    assert db.get(AuthSession, sid).status == "REVOKED"

    # Exercise the endpoint's production cookie-name/path selection as well as
    # the shared helper, using an explicit Host cookie on the test transport.
    production_login = login(api, user.email)
    production_sid = session_id_from_response(
        production_login, production_login.json()["access_token"],
    )
    from http.cookies import SimpleCookie

    cookie_jar = SimpleCookie()
    cookie_jar.load(production_login.headers["set-cookie"])
    production_raw = cookie_jar["evexia_refresh"].value
    api.cookies.clear()
    app.dependency_overrides[get_settings] = lambda: production
    production_logout = api.post(
        "/api/v1/auth/logout",
        headers={
            "Origin": "http://testserver",
            "Cookie": f"__Host-evexia_refresh={production_raw}",
        },
    )
    production_header = production_logout.headers["set-cookie"].lower()
    assert production_logout.status_code == 204
    assert "__host-evexia_refresh=" in production_header
    assert "path=/" in production_header
    assert "secure" in production_header
    assert "httponly" in production_header
    assert "samesite=strict" in production_header
    assert "domain=" not in production_header
    assert db.get(AuthSession, production_sid).status == "REVOKED"


def test_replaying_rotated_successor_revokes_complete_refresh_chain(client):
    api, db, _ = client
    user = create_user(db, "successor-replay@example.com")
    login_response = login(api, user.email)
    assert login_response.status_code == 200
    sid = session_id_from_response(login_response, login_response.json()["access_token"])
    original = api.cookies.get("evexia_refresh")

    first_rotation = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert first_rotation.status_code == 200
    successor = api.cookies.get("evexia_refresh")
    second_rotation = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert second_rotation.status_code == 200
    final_successor = api.cookies.get("evexia_refresh")

    api.cookies.set("evexia_refresh", successor, path="/api/v1/auth")
    replay = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    assert replay.status_code == 401
    assert final_successor != successor
    rows = list(db.scalars(select(RefreshSession).where(RefreshSession.session_id == sid)))
    assert len(rows) == 3
    original_row = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == token_digest(original),
    ))
    successor_row = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == token_digest(successor),
    ))
    final_row = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == token_digest(final_successor),
    ))
    assert original_row.consumed_at is not None
    assert original_row.replaced_by_id == successor_row.id
    assert successor_row.consumed_at is not None
    assert successor_row.replaced_by_id == final_row.id
    assert all(row.revoked_at is not None for row in rows)
    assert db.get(AuthSession, sid).status == "REVOKED"


def test_password_change_racing_refresh_never_leaves_usable_successor():
    """Race refresh and password change on independent committed DB connections."""
    if get_settings().app_env == "production":
        pytest.fail("Session concurrency tests refuse to connect with APP_ENV=production")
    settings = get_settings()
    engine = session_factory().kw["bind"]
    user_id = uuid.uuid4()
    raw_refresh = None
    access = None
    sid = None

    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id=user_id, email=f"password-refresh-race-{user_id.hex}@example.com",
            username=f"pr{user_id.hex[:22]}", password_hash=hash_password(PASSWORD),
            system_role="mr", identity_version=1,
        )
        db.add(user)
        db.flush()
        db.add(MRProfile(user_id=user.id, is_active=True))
        db.flush()
        identity, raw_refresh = auth_service.login(
            db, user.email, PASSWORD, settings, False, "password-refresh-setup", "127.0.0.1",
        )
        access = auth_service.token_response(identity, settings).access_token
        refresh_row = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == token_digest(raw_refresh),
        ))
        sid = refresh_row.session_id
        db.commit()

    gate = Barrier(2)

    def rotate():
        with Session(engine, expire_on_commit=False) as db:
            gate.wait(timeout=10)
            try:
                _, successor = auth_service.rotate_refresh(
                    db, raw_refresh, settings, f"password-race-refresh-{uuid.uuid4().hex}",
                )
                return "rotated", successor
            except auth_service.AuthError:
                return "rejected", None

    def change_password():
        with Session(engine, expire_on_commit=False) as db:
            identity = auth_service.identity_from_token(db, access, settings)
            gate.wait(timeout=10)
            auth_service.change_password(
                db, identity, PASSWORD, "new password after race",
                f"password-race-change-{uuid.uuid4().hex}",
            )
            return "changed"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            refresh_future = pool.submit(rotate)
            password_future = pool.submit(change_password)
            refresh_outcome, successor = refresh_future.result(timeout=30)
            password_outcome = password_future.result(timeout=30)
        assert refresh_outcome in {"rotated", "rejected"}
        assert password_outcome == "changed"

        with Session(engine) as db:
            session = db.get(AuthSession, sid)
            history = list(db.scalars(select(RefreshSession).where(
                RefreshSession.session_id == sid,
            )))
            assert session.status == "REVOKED"
            assert session.revoked_at is not None
            assert history
            assert all(row.revoked_at is not None for row in history)
            assert all(row.consumed_at is None or row.replaced_by_id is not None for row in history)
            if refresh_outcome == "rotated":
                assert successor is not None
                with pytest.raises(auth_service.AuthError):
                    auth_service.rotate_refresh(
                        db, successor, settings, "password-race-successor-recheck",
                    )
            else:
                assert successor is None
            assert db.scalar(select(User.token_version).where(User.id == user_id)) == 1
    finally:
        with Session(engine) as db:
            db.execute(delete(AuditEvent).where(AuditEvent.session_id == sid))
            db.execute(update(RefreshSession).where(
                RefreshSession.session_id == sid,
            ).values(replaced_by_id=None))
            db.execute(delete(RefreshSession).where(RefreshSession.session_id == sid))
            db.execute(delete(AuthSession).where(AuthSession.id == sid))
            db.execute(delete(MRProfile).where(MRProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()