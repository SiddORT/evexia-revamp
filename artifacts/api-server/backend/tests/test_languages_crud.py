"""Synthetic Language CRUD only; no shared database, release or regression checks."""
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import AuditEvent, AuthSession, User
from app.db.language_models import Language, LanguageChange
from app.db.session import session_factory
from app.schemas.languages import LanguageFields, LanguageEdit
from app.services import languages
from app.services.auth import AuthError, Identity
from test_sessions import client, create_user, login
from test_reporting import admin_headers

BASE = "/api/v1/admin/languages"


def add(api, headers, name="Marathi"):
    response = api.post(BASE, headers=headers, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_crud_trim_unicode_search_version_delete_retained_history(client):
    api, db, _ = client
    # Narrow catalog/revision observation of this newly migrated disposable fixture.
    from app.services.fresh_catalog import digest
    observed = dict(revision=db.scalar(text("SELECT version_num FROM alembic_version")),
                    sha256=digest(db.connection()),
                    tables=list(db.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))))
    Path("/tmp/evexia-language-catalog-observation.json").write_text(json.dumps(observed))
    headers, actor = admin_headers(api, db)
    row = add(api, headers, " \tमराठी \u2003")
    assert row["name"] == "मराठी" and row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert set(row) == {"id", "name", "version", "createdBy", "updatedBy", "createdAt", "updatedAt", "deletedBy", "deletedAt"}
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json() == row
    for name in ("English", "हिन्दी", "日本語"):
        add(api, headers, name)
    page = api.get(BASE, headers=headers, params={"query": "english", "limit": 1, "offset": 0}).json()
    assert page["total"] == 4 and page["filtered"] == 1 and len(page["items"]) == 1
    assert api.get(BASE, headers=headers, params={"limit": 2, "offset": 2}).json()["items"]
    assert not api.get(BASE, headers=headers, params={"query": "%_"}).json()["items"]
    changed = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                       json={"name": "मराठी भाषा", "expected_version": 1})
    assert changed.status_code == 200 and changed.json()["version"] == 2
    assert changed.json()["createdAt"] == row["createdAt"]
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"name": "stale", "expected_version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 1}).status_code == 409
    deleted = api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 2})
    assert deleted.status_code == 200 and deleted.json()["deletedAt"] and deleted.json()["deletedBy"] == "Super Admin"
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["total"] == 3
    history = api.get(f"{BASE}/{row['id']}/history", headers=headers, params={"limit": 1, "offset": 1}).json()
    assert history["total"] == 3 and len(history["items"]) == 1 and history["items"][0]["action"] == "edit"
    assert history["items"][0]["beforeName"] == "मराठी" and history["items"][0]["afterName"] == "मराठी भाषा"
    assert history["record"] == deleted.json()
    assert history["summary"] == dict(scope="All committed changes for this language, including deletion",
                                     creates=1, edits=1, deletes=1, total=3, latestChange=deleted.json()["updatedAt"])
    all_history = api.get(f"{BASE}/{row['id']}/history", headers=headers).json()["items"]
    assert [h["version"] for h in all_history] == [1, 2, 3]
    db.expire_all()
    stored = db.get(Language, uuid.UUID(row["id"]))
    assert stored.created_by == stored.updated_by == stored.deleted_by == actor.id
    assert stored.deleted_at == stored.updated_at
    assert add(api, headers, "मराठी भाषा")["id"] != row["id"]
    events = db.scalars(select(AuditEvent).where(AuditEvent.resource_id == stored.id)).all()
    assert len(events) == 3 and {e.action for e in events} == {"language_create", "language_edit", "language_delete"}
    assert all(e.actor_id == actor.id and e.outcome == "success" and e.session_id for e in events)


@pytest.mark.parametrize("value", ["", " \t\u2003", "x" * 201, "bad\u0000name", "bad\nname"])
def test_reject_invalid_name(client, value):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    response = api.post(BASE, headers=headers, json={"name": value})
    assert response.status_code == 422
    assert not db.scalar(select(func.count()).select_from(Language))
    assert not db.scalar(select(func.count()).select_from(LanguageChange))


@pytest.mark.parametrize("extra", [{"status": "active"}, {"code": "en"}, {"locale": "en-IN"},
                                 {"createdBy": "forged"}, {"region": "Asia"}])
def test_name_only_contract_rejects_forgery(client, extra):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    response = api.post(BASE, headers=headers, json={"name": "English", **extra})
    assert response.status_code == 422 and "forged" not in response.text


def test_live_uniqueness_database_and_failed_edit_atomicity(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    row = add(api, headers, "English")
    other = add(api, headers, "हिन्दी")
    assert api.post(BASE, headers=headers, json={"name": "  ENGLISH "}).status_code == 409
    add(api, headers, "École")
    assert api.post(BASE, headers=headers, json={"name": "ÉCOLE"}).status_code == 409
    assert api.post(BASE, headers=headers, json={"name": "école"}).status_code == 409
    assert api.get(BASE, headers=headers, params={"query": "éCOLE"}).json()["filtered"] == 1
    failed = api.post(f"{BASE}/{other['id']}/edit", headers=headers,
                      json={"name": "english", "expected_version": 1})
    assert failed.status_code == 409 and failed.json()["error"]["code"] == "language_duplicate"
    assert api.get(f"{BASE}/{other['id']}", headers=headers).json() == other
    assert api.get(f"{BASE}/{other['id']}/history", headers=headers).json()["total"] == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "language_edit")) == 0
    # Direct writes also hit the PostgreSQL partial unique index.
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            db.execute(text("UPDATE languages SET name='english' WHERE id=:id"), {"id": other["id"]})
    long_unicode = add(api, headers, "語" * 200)
    assert len(long_unicode["name"]) == 200 and row["version"] == 1


def test_authorization_reads_and_all_mutations(client):
    from test_zone_permissions import setup, staff_login, bearer
    api, db, _ = client
    headers, _, _, staff, password = setup(api, db, ["zone.add", "zone.edit", "zone.delete", "zone.import", "zone.export"])
    row = add(api, headers)
    mr = create_user(db, "language-mr@example.com")
    mr_headers = {"Authorization": "Bearer " + login(api, mr.email).json()["access_token"]}
    # An enabled Staff account with every Zone grant still has no Language access.
    staff_headers = bearer(staff_login(api, staff, password))
    for denied, status in (({}, 401), (mr_headers, 403), (staff_headers, 403)):
        for path in (BASE, f"{BASE}/{row['id']}", f"{BASE}/{row['id']}/history"):
            assert api.get(path, headers=denied).status_code == status
        for path, body in ((BASE, {"name": "forbidden"}),
                           (f"{BASE}/{row['id']}/edit", {"name": "forbidden", "expected_version": 1}),
                           (f"{BASE}/{row['id']}/delete", {"expected_version": 1})):
            assert api.post(path, headers=denied, json=body).status_code == status
    assert api.get(f"{BASE}/{row['id']}/history", headers=headers).json()["total"] == 1


def test_revocation_rechecked_inside_mutation_transaction(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    row = add(api, headers)
    session = db.scalar(select(AuthSession).where(AuthSession.user_id == actor.id, AuthSession.status == "ACTIVE"))
    snapshot = Identity(actor, session_id=session.id)
    session.status, session.revoked_at = "REVOKED", utcnow()
    db.commit()
    with pytest.raises(AuthError):
        languages.mutate(db, snapshot, uuid.UUID(row["id"]), LanguageEdit(name="Rejected", expected_version=1), "edit")
    assert db.get(Language, uuid.UUID(row["id"])).version == 1
    assert db.scalar(select(func.count()).select_from(LanguageChange)) == 1


def test_commit_failure_rolls_back_record_history_and_audit(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    def unavailable():
        raise SQLAlchemyError("synthetic commit failure with PRIVATE_BODY")
    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", unavailable)
        response = api.post(BASE, headers=headers, json={"name": "PRIVATE_BODY"})
    assert response.status_code == 503 and "PRIVATE_BODY" not in response.text and response.headers["X-Request-ID"]
    assert not db.scalar(select(func.count()).select_from(Language))
    assert not db.scalar(select(func.count()).select_from(LanguageChange))
    assert not db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.resource_type == "language"))


def test_history_is_append_only_and_browser_activity_not_in_totals(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    row = add(api, headers)
    assert api.post("/api/v1/admin/reporting/activity", headers={**headers, "Origin": "http://testserver"},
                    json={"events": [{"event_id": str(uuid.uuid4()), "action": "created", "resource": "language"}]}).status_code == 204
    for sql in ("DELETE FROM language_changes", "UPDATE language_changes SET after_name='forged'", "TRUNCATE language_changes"):
        with pytest.raises(SQLAlchemyError):
            with db.begin_nested():
                db.execute(text(sql))
    summary = api.get(f"{BASE}/{row['id']}/history", headers=headers).json()["summary"]
    assert summary["total"] == 1 and summary["creates"] == 1


def test_paging_bounds_and_missing_record(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for params in ({"limit": 0}, {"limit": 101}, {"offset": -1}, {"query": "x" * 201}):
        assert api.get(BASE, headers=headers, params=params).status_code == 422
    unknown = uuid.uuid4()
    assert api.get(f"{BASE}/{unknown}/history", headers=headers).status_code == 404
    assert api.get(f"{BASE}/{unknown}/history", headers=headers, params={"limit": 101}).status_code == 422
    assert api.post(f"{BASE}/{unknown}/delete", headers=headers, json={"expected_version": 1}).status_code == 404


def test_concurrent_creates_and_stale_edits_on_independent_connections():
    """Real committed transactions, not a shared savepoint or browser simulation."""
    from pydantic import SecretStr
    from app.bootstrap import bootstrap_super_admin
    from app.core.config import get_settings
    from app.services.auth import login as login_service
    from test_sessions import PASSWORD
    settings = get_settings()
    assert settings.app_env == "test"
    engine = session_factory().kw["bind"]
    with Session(engine) as db:
        owner = bootstrap_super_admin(db, SecretStr(PASSWORD))
        actor = db.get(User, owner.user_id)
        identity, _ = login_service(db, actor.email, PASSWORD, settings, False, "language-crud", "127.0.0.1")
        actor_id, session_id = actor.id, identity.session_id
    gate = Barrier(2)
    name = "Concurrent-" + uuid.uuid4().hex

    def attempt(body, record_id=None):
        with Session(engine) as db:
            actor = Identity(db.get(User, actor_id), session_id=session_id)
            gate.wait(timeout=10)
            try:
                result = languages.create(db, actor, body) if record_id is None else languages.mutate(db, actor, record_id, body, "edit")
                return result
            except languages.LanguageError as exc:
                return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(LanguageFields(name=name)), range(2)))
    assert len([r for r in results if isinstance(r, dict)]) == 1
    assert "language_duplicate" in results
    record = next(r for r in results if isinstance(r, dict))
    gate = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda i: attempt(LanguageEdit(name=name + str(i), expected_version=1), record["id"]), range(2)))
    assert len([r for r in results if isinstance(r, dict)]) == 1
    assert "language_stale" in results
    with Session(engine) as db:
        assert db.get(Language, record["id"]).version == 2
        assert db.scalar(select(func.count()).select_from(LanguageChange).where(LanguageChange.language_id == record["id"])) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.resource_id == record["id"])) == 2
