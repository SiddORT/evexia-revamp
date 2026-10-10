"""Migration 0006 preserves legacy refresh history while disabling old credentials."""
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings


@pytest.fixture
def migration_db(monkeypatch):
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("requires isolated TEST_DATABASE_URL")
    url = make_url(database_url)
    if not url.drivername.startswith("postgresql") or "test" not in (url.database or "").lower():
        pytest.fail("TEST_DATABASE_URL must target an isolated PostgreSQL database whose name includes 'test'")
    schema = f"migration_0006_{uuid.uuid4().hex}"
    admin_engine = create_engine(url)
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    engine = create_engine(isolated_url, hide_parameters=True)
    try:
        command.upgrade(config, "0005_protected_admin")
        yield engine, config
    finally:
        if hasattr(config, "_retirement_recovery"):
            config._retirement_recovery.cleanup()
        engine.dispose()
        get_settings.cache_clear()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def upgrade_with_retirement_recovery(engine, config):
    """Historical round-trips need original empty-scope recovery too.

    This helper is confined to the already-isolated migration fixture. It
    captures the predecessor's complete recovery evidence rather than weakening
    the current migration's mandatory downgrade gate.
    """
    from types import SimpleNamespace
    from app.services import organization_retirement as retirement
    command.upgrade(config, retirement.PREVIOUS)
    config._retirement_recovery = tempfile.TemporaryDirectory(prefix="evexia-test-recovery-")
    path = Path(config._retirement_recovery.name) / "recovery.json"
    with engine.connect() as db, db.begin():
        db.execute(text("SET TRANSACTION READ ONLY"))
        sha = retirement.save_backup(db, path)
        assert retirement.load_backup(path, sha) == retirement.snapshot(db)
    config.cmd_opts = SimpleNamespace(x=[
        f"organization_backup={path}", f"organization_backup_sha256={sha}",
        f"organization_restore_verified={sha}", "organization_retention_resolved=yes",
    ])
    command.upgrade(config, "head")


def test_0006_retires_existing_families_and_keeps_refresh_history(migration_db):
    engine, config = migration_db
    user_id, family_id = uuid.uuid4(), uuid.uuid4()
    first_id, second_id = uuid.uuid4(), uuid.uuid4()
    token_hashes = (uuid.uuid4().hex * 2, uuid.uuid4().hex * 2)
    already_revoked_at = datetime.now(timezone.utc) - timedelta(hours=1)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO users "
            "(id,email,password_hash,is_active,token_version,system_role,identity_version,"
            "is_protected_system_admin) "
            "VALUES (:id,:email,'legacy-hash',true,0,'mr',1,false)"
        ), {"id": user_id, "email": f"legacy-{user_id.hex}@example.test"})
        connection.execute(text(
            "INSERT INTO mr_profiles (id,user_id,is_active) VALUES (:id,:user,true)"
        ), {"id": uuid.uuid4(), "user": user_id})
        connection.execute(text(
            "INSERT INTO refresh_sessions "
            "(id,token_hash,user_id,organization_id,identity_version,family_id,expires_at,"
            "family_expires_at,persistent,revoked_at) "
            "VALUES (:id,:hash,:user,NULL,1,:family,now()+interval '1 day',"
            "now()+interval '1 day',false,:revoked)"
        ), {
            "id": first_id, "hash": token_hashes[0], "user": user_id,
            "family": family_id, "revoked": None,
        })
        # An already-consumed predecessor is retained as history, not rewritten away.
        connection.execute(text(
            "INSERT INTO refresh_sessions "
            "(id,token_hash,user_id,organization_id,identity_version,family_id,expires_at,"
            "family_expires_at,persistent,revoked_at) "
            "VALUES (:id,:hash,:user,NULL,1,:family,now()+interval '1 day',"
            "now()+interval '1 day',false,:revoked)"
        ), {
            "id": second_id, "hash": token_hashes[1], "user": user_id, "family": family_id,
            "revoked": already_revoked_at,
        })

    command.upgrade(config, "head")
    with engine.begin() as connection:
        rows = connection.execute(text(
            "SELECT id,token_hash,user_id,family_id,revoked_at,session_id "
            "FROM refresh_sessions WHERE family_id=:family ORDER BY id"
        ), {"family": family_id}).mappings().all()
        assert len(rows) == 2
        assert {row["id"] for row in rows} == {first_id, second_id}
        assert {row["token_hash"] for row in rows} == set(token_hashes)
        assert {row["user_id"] for row in rows} == {user_id}
        assert all(row["revoked_at"] is not None for row in rows), (
            "Migration must revoke every still-live credential in each pre-session family"
        )
        assert next(row["revoked_at"] for row in rows if row["id"] == second_id) == already_revoked_at
        session_ids = {row["session_id"] for row in rows}
        assert len(session_ids) == 1 and None not in session_ids
        auth_session = connection.execute(text(
            "SELECT id,user_id FROM auth_sessions WHERE id=:id"
        ), {"id": next(iter(session_ids))}).one()
        assert auth_session.user_id == user_id

        foreign_keys = connection.execute(text(
            "SELECT count(*) FROM information_schema.table_constraints "
            "WHERE table_schema=current_schema() AND table_name='refresh_sessions' "
            "AND constraint_type='FOREIGN KEY' AND constraint_name ILIKE '%session%'"
        )).scalar_one()
        assert foreign_keys >= 1

        # The new session binding is mandatory; history cannot become unlinked later.
        with pytest.raises(IntegrityError):
            connection.execute(text(
                "UPDATE refresh_sessions SET session_id=NULL WHERE id=:id"
            ), {"id": first_id})
