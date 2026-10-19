"""PG16/PG17 Unicode compatibility checks using disposable fixtures only."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from test_sessions import client
from test_reporting import admin_headers


@pytest.fixture
def migration(monkeypatch):
    path = Path(__file__).parents[1] / "alembic/versions/0048_language_unicode.py"
    spec = importlib.util.spec_from_file_location("language_unicode_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []

    def bind_for(row):
        return SimpleNamespace(execute=lambda statement: SimpleNamespace(
            mappings=lambda: SimpleNamespace(first=lambda: row)))

    operations = SimpleNamespace(
        get_bind=lambda: bind_for(None),
        execute=lambda statement: calls.append(("execute", str(statement))),
        drop_index=lambda *args, **kwargs: calls.append(("drop", args)),
        create_index=lambda *args, **kwargs: calls.append(("create", args, kwargs)),
    )
    monkeypatch.setattr(module, "op", operations)
    return module, operations, calls, bind_for


def test_missing_pg17_builtin_creates_icu_root_alias_before_index(migration):
    module, _, calls, _ = migration
    module.upgrade()
    assert calls[0] == (
        "execute", 'CREATE COLLATION "pg_c_utf8" FROM pg_catalog."und-x-icu"')
    assert [call[0] for call in calls] == ["execute", "drop", "create"]
    assert calls[-1][2]["unique"] is True
    assert str(calls[-1][2]["postgresql_where"]) == "deleted_at IS NULL"
    assert str(calls[-1][1][2][0]) == 'lower(name COLLATE "pg_c_utf8")'


@pytest.mark.parametrize("row", [
    dict(collprovider="b", collisdeterministic=True, nspname="pg_catalog", locale="C.UTF-8"),
    dict(collprovider="i", collisdeterministic=True, nspname="public", locale="und"),
])
def test_existing_native_or_valid_alias_is_not_recreated(migration, row):
    module, operations, calls, bind_for = migration
    operations.get_bind = lambda: bind_for(row)
    module.upgrade()
    assert [call[0] for call in calls] == ["drop", "create"]


@pytest.mark.parametrize("row", [
    dict(collprovider="c", collisdeterministic=True, nspname="public", locale="C"),
    dict(collprovider="i", collisdeterministic=False, nspname="public", locale="und"),
    dict(collprovider="i", collisdeterministic=True, nspname="public", locale="tr"),
])
def test_incompatible_collation_fails_before_existing_index_is_touched(migration, row):
    module, operations, calls, bind_for = migration
    operations.get_bind = lambda: bind_for(row)
    with pytest.raises(RuntimeError, match="deterministic Unicode root"):
        module.upgrade()
    assert calls == []


def test_unicode_uniqueness_and_retained_crud_on_actual_server(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    base = "/api/v1/admin/languages"
    assert db.scalar(text('SELECT lower(\'ÉCOLE\' COLLATE "pg_c_utf8")')) == "école"
    created = api.post(base, headers=headers, json={"name": "École"})
    assert created.status_code == 201, created.text
    record = created.json()
    assert api.post(base, headers=headers, json={"name": "éCOLE"}).status_code == 409
    assert api.post(base, headers=headers, json={"name": "Ecole"}).status_code == 201
    edited = api.post(f"{base}/{record['id']}/edit", headers=headers,
                      json={"name": "Русский", "expected_version": 1})
    assert edited.status_code == 200, edited.text
    assert edited.json()["version"] == 2
    assert api.post(base, headers=headers, json={"name": "РУССКИЙ"}).status_code == 409
    assert api.get(f"{base}/{record['id']}", headers=headers).json()["name"] == "Русский"
    deleted = api.post(f"{base}/{record['id']}/delete", headers=headers,
                       json={"expected_version": 2})
    assert deleted.status_code == 200, deleted.text
    history = api.get(f"{base}/{record['id']}/history", headers=headers)
    assert history.status_code == 200
    assert history.json()["total"] == 3
