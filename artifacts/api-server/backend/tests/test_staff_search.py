"""Directory search with synthetic encrypted rows in private disposable PostgreSQL."""
import uuid
from datetime import timedelta
from time import perf_counter

from pydantic import SecretStr
from sqlalchemy import event, select

from app.core.security import utcnow
from app.db.models import AuditEvent, User
from app.db.staff_models import StaffProfile
from app.schemas.staff import StaffFields
from app.services.staff import assign
from app.services.staff_crypto import StaffCrypto
from test_sessions import client, create_user, login
from test_staff import BASE, BODY, admin_headers

SEARCH = BASE + "/search"


def seed(db, settings, admin, count=605):
    crypto = StaffCrypto(settings)
    now = utcnow()
    for index in range(1, count + 1):
        user = User(id=uuid.uuid4(), username=f"st_{index:028x}",
                    email=None, password_hash=admin.password_hash, system_role=None)
        db.add(user)
        profile = StaffProfile(id=uuid.UUID(int=index), user_id=user.id, version=1,
                               created_by=admin.id, updated_by=admin.id,
                               created_at=now + timedelta(seconds=index), updated_at=now)
        assign(profile, StaffFields(**{**BODY, "name": f"Fictional Directory {index}",
                                      "email": f"directory-{index}@example.com"}), crypto)
        db.add(profile)
    db.commit()


def test_find_beyond_first_hundred_and_bounded_empty_sections(client, monkeypatch, caplog):
    api, db, settings = client
    headers, admin = admin_headers(api, db)
    seed(db, settings, admin)
    first = api.get(BASE, headers=headers, params={"limit": 100}).json()
    target = str(uuid.UUID(int=1))
    assert target not in [row["id"] for row in first["items"]]
    audit_before = len(list(db.scalars(select(AuditEvent))))
    calls = []
    original = StaffCrypto.decrypt
    def decrypt(self, *args):
        calls.append(args[1])
        return original(self, *args)
    monkeypatch.setattr(StaffCrypto, "decrypt", decrypt)
    sql = []
    def record_sql(_conn, _cursor, statement, _parameters, *_args):
        sql.append(statement)
    connection = db.connection()
    event.listen(connection, "before_cursor_execute", record_sql)
    start = perf_counter()
    try:
        response = api.post(SEARCH, headers=headers, json={"query": "directory-1@example.com"})
    finally:
        event.remove(connection, "before_cursor_execute", record_sql)
    elapsed = perf_counter() - start
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    page = response.json()
    assert [row["id"] for row in page["items"]] == [target]
    assert page["scanned"] == page["scan_limit"] == 500 and page["has_more"]
    assert page["next_cursor"] == str(uuid.UUID(int=500))
    assert len(calls) == 1501  # three fields per row + authorization email/key check
    assert len(sql) < 12  # not one User SELECT per scanned staff row
    assert elapsed < 5
    assert not any("OFFSET" in statement or "count(" in statement.lower() for statement in sql)
    print(f"500-row encrypted search: {elapsed:.3f}s, {len(sql)} SQL statements, {len(calls)} decryptions")
    for query in ("not-present-anywhere", "DIRECTORY-605@EXAMPLE.COM"):
        page = api.post(SEARCH, headers=headers, json={"query": query}).json()
        assert page["items"] == [] and page["has_more"] and page["scanned"] == 500
        tail = api.post(SEARCH, headers=headers, json={"query": query, "cursor": page["next_cursor"]}).json()
        assert tail["scanned"] == 105 and not tail["has_more"] and tail["next_cursor"] is None
        assert len(tail["items"]) == (0 if query == "not-present-anywhere" else 1)
    assert len(list(db.scalars(select(AuditEvent)))) == audit_before
    assert "directory-1@example.com" not in caplog.text
    assert "DIRECTORY-605@EXAMPLE.COM" not in caplog.text
    assert "initial_password" not in response.text and "password_hash" not in response.text


def test_matching_pagination_has_no_skips_or_duplicates_and_no_writes(client):
    api, db, settings = client
    headers, admin = admin_headers(api, db)
    seed(db, settings, admin, 205)
    ids, cursor = [], None
    for expected in (100, 100, 5):
        response = api.post(SEARCH, headers=headers, json={"query": "fictional", "cursor": cursor})
        assert response.status_code == 200
        page = response.json()
        assert len(page["items"]) == page["scanned"] == expected
        ids.extend(row["id"] for row in page["items"])
        assert all(row["version"] == 1 for row in page["items"])
        cursor = page["next_cursor"]
        assert page["has_more"] == (expected == 100)
    assert len(set(ids)) == 205 and cursor is None
    for query in ("987654", "st_000", "executive", "2025-01", "active", "super admin", "IN"):
        assert api.post(SEARCH, headers=headers, json={"query": query, "limit": 1}).json()["items"]


def test_search_denials_validation_keys_and_corrupt_nonmatches(client, monkeypatch):
    api, db, settings = client
    assert api.post(SEARCH, json={"query": "fictional"}).status_code == 401
    mr = create_user(db, "fictional-mr@example.com")
    token = login(api, mr.email).json()["access_token"]
    assert api.post(SEARCH, headers={"Authorization": f"Bearer {token}"}, json={"query": "fictional"}).status_code == 403
    headers, admin = admin_headers(api, db)
    seed(db, settings, admin, 2)
    for body in ({"query": " "}, {"query": "a"}, {"query": "x" * 201},
                 {"query": "a\nb"}, {"query": "secret-invalid-query", "cursor": "bad-secret-cursor"},
                 {"query": "fictional", "limit": 101}, {"query": "fictional", "limit": 0},
                 {"query": "fictional", "private-term-field": "private"}):
        response = api.post(SEARCH, headers=headers, json=body)
        assert response.status_code == 422
        assert "secret-invalid-query" not in response.text and "bad-secret-cursor" not in response.text
        assert "private-term-field" not in response.text
    for field, value in (("staff_encryption_keys", SecretStr("")),
                         ("staff_encryption_key_id", "missing"),
                         ("staff_email_index_key", SecretStr("Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="))):
        original = getattr(settings, field)
        monkeypatch.setattr(settings, field, value)
        response = api.post(SEARCH, headers=headers, json={"query": "no-match"})
        assert response.status_code == 503 and "items" not in response.json()
        monkeypatch.setattr(settings, field, original)
    profile = db.get(StaffProfile, uuid.UUID(int=2))
    profile.name_ciphertext = profile.phone_ciphertext
    db.commit()
    assert api.post(SEARCH, headers=headers, json={"query": "no-match"}).status_code == 503
    assert api.post("/api/v1/auth/logout", headers={**headers, "Origin": "http://testserver"}).status_code == 204
    assert api.post(SEARCH, headers=headers, json={"query": "fictional"}).status_code == 401
