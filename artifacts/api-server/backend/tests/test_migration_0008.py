"""Activity index DDL and projection verified only in a disposable test schema."""
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import get_settings


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="isolated TEST_DATABASE_URL required")
def test_activity_index_projection_upgrade_downgrade_and_history_retention(monkeypatch):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert "test" in url.database
    schema = f"activity_index_test_{uuid.uuid4().hex}"
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    # Never include public: Alembic would discover the outer schema's version
    # table and accidentally operate on that schema instead of this test's.
    isolated_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    isolated = create_engine(isolated_url)
    try:
        command.upgrade(config, "head")
        with isolated.begin() as conn:
            conn.execute(text("""
                INSERT INTO audit_events(id, action, outcome, request_id)
                VALUES (:id, 'unsafe marker!', 'success', 'safe_request:42')
            """), {"id": uuid.uuid4()})
            value = conn.scalar(text("""
                SELECT evexia_activity_text_v1(
                    'private action!', 'private outcome!', 'private reason!',
                    'private resource!', 'private session!', 'private request!', NULL)
            """))
            assert value == "unavailable|unavailable"
            value = conn.scalar(text("""
                SELECT evexia_activity_text_v1(
                    'login_success', 'success', NULL, 'auth', 'safe-session_ref',
                    'Safe.Request:42', '00000000-0000-0000-0000-000000000001')
            """))
            assert value == ("login_success|success|auth|safe-session_ref|Safe.Request:42|"
                             "00000000-0000-0000-0000-000000000001")
            assert conn.scalar(text("SELECT to_regclass('ix_audit_events_safe_text_trgm')")) is not None
        command.downgrade(config, "0007_reporting_indexes")
        with isolated.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM audit_events")) == 1
            assert conn.scalar(text("SELECT to_regclass('ix_audit_events_safe_text_trgm')")) is None
        command.upgrade(config, "head")
        with isolated.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM audit_events")) == 1
            assert conn.scalar(text("""
                SELECT lower(evexia_activity_text_v1(
                    action, outcome, reason, resource_type, session_id, request_id, resource_id))
                FROM audit_events
            """)) == "unavailable|success|safe_request:42"
    finally:
        isolated.dispose()
        get_settings.cache_clear()
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()
