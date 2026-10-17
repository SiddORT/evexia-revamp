"""Actual atomic additive DDL, exclusively in disposable harness databases."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[4]


@pytest.fixture
def rollout(tmp_path, monkeypatch):
    configured = os.environ["TEST_DATABASE_URL"]
    assert "evexia_api_test" in configured
    admin = create_engine(configured, isolation_level="AUTOCOMMIT", hide_parameters=True)
    name = "evexia_dev_rollout_" + uuid.uuid4().hex
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    engine = create_engine(make_url(configured).set(database=name), hide_parameters=True)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE alembic_version(version_num varchar(80) NOT NULL)")
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('0040_po_tax_basis')")
        connection.exec_driver_sql("CREATE TABLE sentinel(id integer PRIMARY KEY, note text NOT NULL)")
        connection.exec_driver_sql("INSERT INTO sentinel VALUES (1,'preserve')")
        info = connection.connection.driver_connection.info
        cluster, oid = connection.exec_driver_sql(
            "SELECT system_identifier::text,(SELECT oid FROM pg_database WHERE datname=current_database()) FROM pg_control_system()"
        ).one()
        binding = dict(version=1, host=info.host, port=info.port, database=name, cluster=cluster, oid=oid)
    spec = importlib.util.spec_from_file_location("private_development_rollout", ROOT / "scripts/development-sync.py")
    sync = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = sync
    spec.loader.exec_module(sync)
    backend = tmp_path / "backend"
    versions = backend / "alembic/versions"
    versions.mkdir(parents=True)
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts/development-database.json").write_text(json.dumps(binding))
    # Real Alembic runner; only this private synthetic graph is supplied.
    (tmp_path / "scripts/deploy-migrations.py").write_bytes((ROOT / "scripts/deploy-migrations.py").read_bytes())
    (backend / "alembic.ini").write_text("[alembic]\n")
    (backend / "alembic/env.py").write_text(
        "from alembic import context\nc=context.config.attributes['connection']\n"
        "assert c.in_transaction()\ncontext.configure(connection=c)\ncontext.run_migrations()\n")
    (versions / "base.py").write_text(
        "revision='0040_po_tax_basis'\ndown_revision=None\n"
        "def upgrade():\n    pass\ndef downgrade():\n    pass\n")
    path = versions / "next.py"
    def migration(body="op.add_column('sentinel',sa.Column('extra',sa.JSON(),nullable=True))", classification="automatic"):
        path.write_text(
            "from alembic import op\nimport sqlalchemy as sa\nrevision='0041_fixture'\n"
            "down_revision='0040_po_tax_basis'\nbranch_labels=depends_on=None\n"
            "def upgrade():\n" + "".join("    " + line + "\n" for line in body.splitlines()) +
            "def downgrade():\n    pass\n")
        (tmp_path / "scripts/migration-policy.json").write_text(json.dumps(
            {"version": 1, "revisions": {"0040_po_tax_basis": "operator_only", "0041_fixture": classification}}))
    migration()
    import app.core.config as config
    import app.core.schema as schema
    import app.fresh_install as fresh
    import app.api.v1.system as system
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    monkeypatch.setattr(sync, "BACKEND", backend)
    settings = SimpleNamespace(app_env="development", database_url=engine.url.render_as_string(hide_password=False))
    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(schema, "SCHEMA_REVISION", "0041_fixture")
    # Source-pin/fresh-catalog checks are exercised separately on the real
    # graph. This test deliberately supplies a tiny private migration graph.
    monkeypatch.setattr(fresh, "reviewed_graph", lambda: {})
    monkeypatch.setattr(system, "readiness", lambda db: {"status": "ready"})
    try:
        yield sync, engine, settings, binding, migration, tmp_path, system
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def snapshot(engine):
    with engine.connect() as connection:
        return (
            list(connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalars()),
            connection.exec_driver_sql("SELECT id,note FROM sentinel").all(),
            list(connection.exec_driver_sql(
                "SELECT column_name FROM information_schema.columns WHERE table_name='sentinel' ORDER BY ordinal_position").scalars()),
        )


def test_automatic_addition_preserves_records_and_advances_exact_target(rollout):
    sync, engine, *_ = rollout
    assert sync.synchronize() == 0
    assert snapshot(engine) == (["0041_fixture"], [(1, "preserve")], ["id", "note", "extra"])


def test_protected_pending_applies_zero_migrations(rollout):
    sync, engine, _, _, migration, *_ = rollout
    before = snapshot(engine)
    migration(classification="operator_only")
    assert sync.synchronize() == 42
    assert snapshot(engine) == before


@pytest.mark.parametrize("field", ["host", "port", "database", "cluster", "oid"])
def test_wrong_target_rejected_without_ddl(rollout, field):
    sync, engine, _, binding, _, root, _ = rollout
    before = snapshot(engine)
    binding[field] = 1 if field in ("port", "oid") else "wrong"
    (root / "scripts/development-database.json").write_text(json.dumps(binding))
    with pytest.raises(sync.Blocked, match="WRONG_DEVELOPMENT_DATABASE"):
        sync.synchronize()
    assert snapshot(engine) == before


def test_production_environment_cannot_run_automatic_development_changes(rollout):
    sync, engine, settings, *_ = rollout
    before = snapshot(engine)
    settings.app_env = "production"
    with pytest.raises(sync.Blocked, match="DEVELOPMENT_ONLY"):
        sync.synchronize()
    assert snapshot(engine) == before


def test_mid_upgrade_failure_rolls_back_columns_and_revision(rollout):
    sync, engine, _, _, migration, *_ = rollout
    before = snapshot(engine)
    migration("op.add_column('sentinel',sa.Column('extra',sa.JSON(),nullable=True))\n"
              "op.add_column('sentinel',sa.Column('extra',sa.JSON(),nullable=True))")
    with pytest.raises(Exception):
        sync.synchronize()
    assert snapshot(engine) == before


def test_readiness_failure_rolls_back_migration_too(rollout, monkeypatch):
    sync, engine, _, _, _, _, system = rollout
    before = snapshot(engine)
    def fail(_db):
        raise RuntimeError("synthetic missing key/runtime anchor")
    monkeypatch.setattr(system, "readiness", fail)
    with pytest.raises(RuntimeError):
        sync.synchronize()
    assert snapshot(engine) == before


def test_fresh_database_cannot_bypass_protected_history(rollout):
    sync, engine, *_ = rollout
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE alembic_version")
    with pytest.raises(sync.Blocked, match="FRESH_DATABASE_REQUIRES_SUPPORTED_FRESH_INSTALL"):
        sync.synchronize()
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT note FROM sentinel").scalar_one() == "preserve"


def test_unknown_policy_applies_nothing(rollout):
    sync, engine, _, _, _, root, _ = rollout
    before = snapshot(engine)
    path = root / "scripts/migration-policy.json"
    policy = json.loads(path.read_text())
    del policy["revisions"]["0041_fixture"]
    path.write_text(json.dumps(policy))
    with pytest.raises(Exception):
        sync.synchronize()
    assert snapshot(engine) == before


def test_multiple_database_heads_apply_nothing(rollout):
    sync, engine, *_ = rollout
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('0041_fixture')")
    before = snapshot(engine)
    with pytest.raises(Exception):
        sync.synchronize()
    assert snapshot(engine) == before
