"""Real additive upgrade on private disposable schemas, never a managed target."""
from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from alembic import command
from alembic.config import Config
import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

from app.core.config import get_settings

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("hostname_operator_integration", ROOT / "scripts/operator-hostnames.py")
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


@pytest.fixture
def predecessor(monkeypatch):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert "test" in url.database and get_settings().app_env == "test"
    schema = "hostname_operator_" + uuid.uuid4().hex
    admin = sa.create_engine(url, hide_parameters=True)
    with admin.begin() as db:
        db.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    isolated = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated.render_as_string(hide_password=False))
    get_settings.cache_clear()
    config = Config(str(scope.BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(scope.BACKEND / "alembic"))
    engine = sa.create_engine(isolated, hide_parameters=True)
    try:
        command.upgrade(config, scope.PREDECESSOR)
        with engine.begin() as db:
            db.execute(sa.text(
                "INSERT INTO organizations(id,name) VALUES (:id,'Synthetic retained organization')"
            ), {"id": uuid.uuid4()})
        yield engine, schema
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin.begin() as db:
            db.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def projection(db, schema):
    return db.execute(sa.text(
        "SELECT table_name,column_name,data_type,is_nullable "
        "FROM information_schema.columns WHERE table_schema=:schema "
        "AND table_name NOT IN ('role_hostnames','alembic_version') "
        "ORDER BY table_name,ordinal_position"
    ), {"schema": schema}).all()

@pytest.fixture
def reviewed_runner(monkeypatch):
    """Frozen reviewed release metadata; real migrations still run on private PG."""
    runner = scope.runner_module()
    graph = runner.load_graph(scope.BACKEND / "alembic/versions")
    policy = runner.load_policy(scope.ROOT / "scripts/migration-policy.json")
    retained, pending = set(), [scope.REVIEWED_HEAD]
    while pending:
        revision = pending.pop()
        if revision not in retained:
            retained.add(revision)
            pending.extend(graph[revision].down_revision + graph[revision].depends_on)
    monkeypatch.setattr(runner, "load_graph", lambda _: {key: graph[key] for key in retained})
    monkeypatch.setattr(runner, "load_policy", lambda _: {key: policy[key] for key in retained})
    monkeypatch.setattr(runner, "literal_assignments",
                        lambda *_: {"SCHEMA_REVISION": scope.REVIEWED_HEAD})
    monkeypatch.setattr(scope, "runner_module", lambda: runner)
    return runner


def test_real_scoped_upgrade_changes_only_hostname_schema(predecessor, reviewed_runner):
    engine, schema = predecessor
    runner = scope.runner_module()
    @contextmanager
    def synthetic_recovery(*args):
        # File/attestation gates are tested separately with restricted fixtures.
        # This is not live recovery or rehearsal evidence.
        yield {}
    with engine.connect() as db:
        plan = scope.inspect_database(db, runner, "a" * 40)
        with db.begin():
            before = projection(db, schema)
            retained = db.execute(sa.text("SELECT id,name FROM organizations ORDER BY id")).all()
        args = SimpleNamespace(approve_hostnames=True, writers_stopped=True, recovery_reviewed=True,
                               approval=scope.canonical_digest(plan), release_sha="a" * 40,
                               backup="synthetic-only", recovery_evidence="synthetic-only")
        real_run = scope.subprocess.run
        with patch.object(scope, "verified_recovery", synthetic_recovery), \
                patch.object(scope, "require_host_interlock"), patch.object(scope, "verify_source"), \
                patch.object(scope.subprocess, "run", wraps=real_run) as run:
            result = scope.execute_scoped(db, runner, args, plan)
            run.assert_called_once()
            assert run.call_args.args[0][-2:] == ["upgrade", "0031_role_hostnames"]
        with db.begin():
            assert projection(db, schema) == before
            assert db.execute(sa.text("SELECT id,name FROM organizations ORDER BY id")).all() == retained
            assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == scope.TARGET
            assert db.scalar(sa.text("SELECT count(*) FROM role_hostnames")) == 0
            assert db.scalar(sa.text("SELECT role FROM role_hostnames WHERE hostname='synthetic.example.com'")) is None
        assert result["migrations_applied"] == 1
        assert result["full_release_readiness"] == "not_established"


@pytest.mark.parametrize("revision", [
    "0031_role_hostnames", "0031_remove_organizations", "0033_merge_directory_branches",
    "0034_shared_phone_countries", "unknown_future",
])
def test_real_inspection_rejects_later_or_inconsistent_revision_without_migration(predecessor, reviewed_runner, revision):
    engine, _ = predecessor
    with engine.begin() as db:
        db.execute(sa.text("UPDATE alembic_version SET version_num=:revision"), {"revision": revision})
    with engine.connect() as db, patch.object(scope.subprocess, "run") as run:
        with pytest.raises(Exception):
            scope.inspect_database(db, scope.runner_module(), "a" * 40)
        run.assert_not_called()


def test_conflicting_hostname_relation_stops_before_migration(predecessor, reviewed_runner):
    engine, schema = predecessor
    with engine.begin() as db:
        db.execute(sa.text('CREATE TABLE role_hostnames(id integer)'))
    with engine.connect() as db, patch.object(scope.subprocess, "run") as run:
        with pytest.raises(scope.ScopeError, match="HOSTNAME_RELATION"):
            scope.inspect_database(db, scope.runner_module(), "a" * 40)
        run.assert_not_called()


def test_current_unreviewed_release_is_rejected_before_migration(predecessor):
    engine, _ = predecessor
    with engine.connect() as db, patch.object(scope.subprocess, "run") as run:
        with pytest.raises(scope.ScopeError, match="CHANGED_RELEASE_REQUIRES_NEW_OPERATOR_REVIEW"):
            scope.inspect_database(db, scope.runner_module(), "a" * 40)
        run.assert_not_called()
