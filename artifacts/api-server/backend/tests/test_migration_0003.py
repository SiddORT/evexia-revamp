import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.engine import make_url

from app.core.config import get_settings


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="requires isolated TEST_DATABASE_URL")
def test_0003_preserves_legacy_rows_and_rejects_unmapped_privilege_inference(monkeypatch):
    """Exercise migrations only in a throwaway PostgreSQL schema on an explicitly named test DB."""
    url = make_url(os.environ["TEST_DATABASE_URL"])
    database = (url.database or "").lower()
    if not url.drivername.startswith("postgresql") or "test" not in database:
        pytest.fail("TEST_DATABASE_URL must target a PostgreSQL database whose name includes 'test'")
    schema = f"task144_{uuid.uuid4().hex}"
    admin_engine = create_engine(url)
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    isolated_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", str(isolated_url))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    try:
        command.upgrade(config, "0002_username")
        engine = create_engine(isolated_url)
        org_id, user_id, membership_id, refresh_id = (uuid.uuid4() for _ in range(4))
        with engine.begin() as connection:
            connection.execute(text(
                "INSERT INTO organizations (id, name) VALUES (:id, 'Legacy org')"
            ), {"id": org_id})
            connection.execute(text(
                "INSERT INTO users (id, email, password_hash, is_active, token_version) "
                "VALUES (:id, 'legacy@test.example', 'oldhash', true, 0)"
            ), {"id": user_id})
            connection.execute(text(
                "INSERT INTO memberships (id, user_id, organization_id, role, is_active) "
                "VALUES (:id, :user, :org, 'owner', true)"
            ), {"id": membership_id, "user": user_id, "org": org_id})
            connection.execute(text(
                "INSERT INTO refresh_sessions "
                "(id, token_hash, user_id, organization_id, family_id, expires_at) "
                "VALUES (:id, :hash, :user, :org, :family, now() + interval '1 day')"
            ), {
                "id": refresh_id, "hash": uuid.uuid4().hex, "user": user_id,
                "org": org_id, "family": uuid.uuid4(),
            })

        command.upgrade(config, "0003_system_domain")
        with engine.begin() as connection:
            identity = connection.execute(text(
                "SELECT system_role, identity_version FROM users WHERE id=:id"
            ), {"id": user_id}).one()
            assert identity.system_role is None
            assert identity.identity_version == 0
            assert connection.execute(text(
                "SELECT organization_id FROM refresh_sessions WHERE id=:id"
            ), {"id": refresh_id}).scalar_one() == org_id
            assert connection.execute(text(
                "SELECT count(*) FROM memberships WHERE user_id=:id"
            ), {"id": user_id}).scalar_one() == 1
            with pytest.raises(IntegrityError):
                connection.execute(text(
                    "UPDATE users SET system_role='owner' WHERE id=:id"
                ), {"id": user_id})
            # Failed constraint statement aborts this transaction; rollback is implicit on exit.

        # A clean rollback to the legacy identity revision must retain organization
        # rows, memberships, and original refresh organization history.
        command.downgrade(config, "0002_username")
        with engine.begin() as connection:
            assert connection.execute(text(
                "SELECT name FROM organizations WHERE id=:id"
            ), {"id": org_id}).scalar_one() == "Legacy org"
            assert connection.execute(text(
                "SELECT organization_id FROM memberships WHERE id=:id"
            ), {"id": membership_id}).scalar_one() == org_id
            assert connection.execute(text(
                "SELECT organization_id FROM refresh_sessions WHERE id=:id"
            ), {"id": refresh_id}).scalar_one() == org_id
            assert "system_role" not in {
                row[0] for row in connection.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema=current_schema() AND table_name='users'"
                ))
            }
        engine.dispose()
    finally:
        get_settings.cache_clear()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()