"""Real production guards on socket-only disposable PG, not the workspace DB."""
import fcntl
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from alembic import command
from fastapi import Response
from pydantic import SecretStr
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app import fresh_install as fresh
from app.core.config import get_settings
from app.core.security import verify_password

# The ordinary API suite has a different database/environment. These tests
# require the explicit production-mode, two-cluster harness, never its DB.
pytestmark = pytest.mark.skipif(
    not os.environ.get("FRESH_TEST_ROOT", "").startswith("/tmp/evexia-fresh-install."),
    reason="Run scripts/test-fresh-install.sh for isolated production-mode coverage.",
)


@pytest.fixture
def databases():
    root = Path(os.environ.get("FRESH_TEST_ROOT", "/nonexistent"))
    if not str(root).startswith("/tmp/evexia-fresh-install.") or not root.is_dir():
        pytest.skip("Use scripts/test-fresh-install.sh; never the configured workspace database.")
    assert root.stat().st_mode & 0o077 == 0
    assert os.environ["APP_ENV"] == "production"
    engines = []
    for cluster in ("source", "rehearsal"):
        socket = root / cluster / "socket"
        subprocess.run(["createdb", "-h", str(socket), "fresh_install"], check=True, capture_output=True)
        engines.append(create_engine(f"postgresql+psycopg://{getpass.getuser()}"
                                     f"@/fresh_install?host={socket}&port=5432", hide_parameters=True))
    try:
        yield (*engines, root)
    finally:
        for engine in engines:
            engine.dispose()
        for cluster in ("source", "rehearsal"):
            subprocess.run(["dropdb", "-h", str(root / cluster / "socket"), "fresh_install"],
                           check=True, capture_output=True)


def test_review_covers_every_revision_and_policy():
    assert len(fresh.reviewed_graph()) == 39


def test_review_rejects_changed_or_unknown_migration(tmp_path):
    shutil.copytree(fresh.ROOT / "scripts", tmp_path / "scripts",
                    ignore=shutil.ignore_patterns("__pycache__"))
    versions = tmp_path / "artifacts/api-server/backend/alembic/versions"
    shutil.copytree(fresh.BACKEND / "alembic/versions", versions)
    for path in json.loads((tmp_path / "scripts/fresh-install-review.json").read_text())["guard_sources"]:
        target = tmp_path / "artifacts/api-server/backend" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fresh.BACKEND / path, target)
    path = versions / "unreviewed.py"
    path.write_text("revision='unreviewed'\ndown_revision='0034_shared_phone_countries'\n")
    with pytest.raises(fresh.FreshInstallBlocked, match="review required"):
        fresh.reviewed_graph(tmp_path)
    path.unlink()
    next(versions.glob("0001*.py")).write_text("revision='0001_identity'\n")
    with pytest.raises(fresh.FreshInstallBlocked, match="review required"):
        fresh.reviewed_graph(tmp_path)


def test_explicit_phase_approvals_cannot_be_reused():
    with patch.object(fresh, "verify_supervisor") as supervisor:
        assert fresh.main(["prepare", "--writers-stopped"]) == 1
        assert fresh.main(["finalize", "--approve-fresh-install", "--writers-stopped"]) == 1
        assert fresh.main(["prepare", "--approve-fresh-install", "--approve-bootstrap", "--writers-stopped"]) == 1
        assert fresh.main(["prepare", "--approve-fresh-install"]) == 1
        supervisor.assert_not_called()


def test_production_crypto_and_password_required():
    fresh.configuration(get_settings())
    settings = get_settings().model_copy(update={"super_admin_initial_password": SecretStr("short")})
    with pytest.raises(fresh.FreshInstallBlocked):
        fresh.configuration(settings)
    settings = get_settings().model_copy(update={"directory_index_key": SecretStr("bad")})
    with pytest.raises(Exception):
        fresh.configuration(settings)


def test_existing_extension_membership_cannot_hide_a_table(databases):
    source, _, _ = databases
    with source.begin() as db:
        db.execute(text("CREATE EXTENSION pg_trgm WITH SCHEMA public"))
        db.execute(text("CREATE TABLE unrelated(id int)"))
        db.execute(text("ALTER EXTENSION pg_trgm ADD TABLE unrelated"))
    with pytest.raises(fresh.FreshInstallBlocked), source.begin() as db:
        fresh.prepare(db)


def test_cli_preparation_and_normal_policy_barrier(databases, tmp_path, monkeypatch):
    source, _, _ = databases
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    with lock.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        assert fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped"]) == 0
        assert fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped"]) == 1
    result = subprocess.run([sys.executable, "-B",
                             str(fresh.ROOT / "scripts/deploy-migrations.py"),
                             "--backend-dir", str(fresh.BACKEND)], capture_output=True, text=True)
    assert result.returncode == 42, result.stderr
    assert "OPERATOR_MIGRATION_REQUIRED" in result.stdout
    with source.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == fresh.PREPARE_TARGET


def test_supervisor_requires_already_held_canonical_exclusive_flock(tmp_path, monkeypatch):
    lock = tmp_path / ".deploy.lock"
    marker = tmp_path / ".operator-maintenance"
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    with lock.open("w") as handle:
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        marker.touch()
        with pytest.raises(fresh.FreshInstallBlocked):
            fresh.verify_supervisor()
        fcntl.flock(handle, fcntl.LOCK_EX)
        fresh.verify_supervisor()
        marker.unlink()
        marker.symlink_to(lock)
        with pytest.raises(fresh.FreshInstallBlocked):
            fresh.verify_supervisor()
        marker.unlink()
        marker.touch()
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock) + ".wrong")
        with pytest.raises(fresh.FreshInstallBlocked):
            fresh.verify_supervisor()


@pytest.mark.parametrize("sql", [
    "CREATE TABLE alembic_version(version_num varchar(100))",
    "CREATE TABLE unrelated(id int)",
    "CREATE SCHEMA unrelated",
    "CREATE FUNCTION public.unrelated() RETURNS integer LANGUAGE SQL AS 'SELECT 1'",
])
def test_non_pristine_database_refused_without_changes(databases, sql):
    source, _, _ = databases
    with source.begin() as db:
        db.execute(text(sql))
    before = inspect(source).get_table_names()
    with pytest.raises(fresh.FreshInstallBlocked), source.begin() as db:
        fresh.prepare(db)
    assert inspect(source).get_table_names() == before


def test_transaction_rolls_back_entire_preparation(databases):
    source, _, _ = databases
    with pytest.raises(RuntimeError), source.begin() as db:
        fresh.prepare(db)
        raise RuntimeError("Synthetic failure before commit")
    assert inspect(source).get_table_names() == []
    with source.connect() as db:
        fresh.pristine(db)


def test_existing_trusted_trigram_extension_is_allowed(databases):
    source, _, _ = databases
    with source.begin() as db:
        db.execute(text("CREATE EXTENSION pg_trgm WITH SCHEMA public"))
        fresh.pristine(db)


def test_preparation_stops_and_original_production_retirement_guard_survives(databases):
    source, _, _ = databases
    with source.begin() as db:
        fresh.prepare(db)
    with source.connect() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalars().all() == [fresh.PREPARE_TARGET]
    assert "organizations" in inspect(source).get_table_names()
    with pytest.raises(Exception, match="Separate operator approval"), source.begin() as db:
        command.upgrade(fresh.alembic_config(db), fresh.FINAL_TARGET)
    with pytest.raises(fresh.FreshInstallBlocked), source.begin() as db:
        fresh.prepare(db)
    with pytest.raises(fresh.FreshInstallBlocked, match="protected operator"), source.begin() as db:
        fresh.finalize(db, get_settings())


def test_independent_restore_then_real_guarded_continuation_and_atomic_bootstrap(databases, tmp_path, monkeypatch):
    from app.services import organization_retirement as recovery
    from app.api.v1.system import readiness
    from app.api.v1.role_urls import resolve
    from app.db.models import User
    source, rehearsal, root = databases
    with source.begin() as db:
        fresh.prepare(db)
    custody = root / "custody"
    custody.mkdir(mode=0o700)
    with source.connect() as db:
        report = recovery.preflight(db)
        assert report["unexpected_dependency_count"] == 0, str(report)
        payload = recovery.snapshot(db)
        digest = recovery.save_backup(db, custody / "recovery.json")
    # A SHA alone is NOT restoration proof. Actually dump/restore into the
    # independent second cluster before any retirement approval is supplied.
    archive = custody / "predecessor.dump"
    subprocess.run(["pg_dump", "-h", str(root / "source/socket"), "-Fc", "-f", str(archive),
                    "--exclude-table-data=public.alembic_version",
                    "--exclude-table-data=public.directory_crypto_stage",
                    "fresh_install"], check=True, capture_output=True)
    # Recreate schema through real historical migrations. A full pg_restore
    # reserializes the membership role CHECK, which the existing strict guard
    # deliberately rejects. Do not relax that guard or edit restored DDL.
    with rehearsal.begin() as db:
        fresh.prepare(db)
    subprocess.run(["pg_restore", "-h", str(root / "rehearsal/socket"), "-d", "fresh_install",
                    "--data-only", "--exit-on-error", str(archive)], check=True, capture_output=True)
    with rehearsal.connect() as db:
        report = recovery.preflight(db)
        assert report["unexpected_dependency_count"] == 0, str(report)
        assert recovery.snapshot(db) == recovery.load_backup(custody / "recovery.json", digest)
    arguments = [
        "organization_removal_approved=yes", "organization_writers_stopped=yes",
        "organization_external_consumers_reviewed=yes", "organization_backup_durable=yes",
        "organization_retention_resolved=yes", f"organization_backup={custody / 'recovery.json'}",
        f"organization_backup_sha256={digest}", f"organization_restore_verified={digest}",
    ]
    # Explicit approvals only for these test-owned databases, after real restoration.
    for engine in (rehearsal, source):
        with engine.begin() as db:
            config = fresh.alembic_config(db)
            config.cmd_opts = SimpleNamespace(x=arguments)
            # Each target is deliberate; never upgrade head.
            for target in ("0031_remove_organizations", "0033_merge_directory_branches", fresh.FINAL_TARGET):
                command.upgrade(config, target)
    with pytest.raises(RuntimeError), source.begin() as db:
        fresh.finalize(db, get_settings(), "fresh.allergyevexia.in")
        raise RuntimeError("Synthetic failure after bootstrap; outer transaction still owns commit")
    with source.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM users")) == 0
        assert db.scalar(text("SELECT count(*) FROM role_hostnames")) == 0
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    with lock.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        assert fresh.main(["finalize", "--approve-bootstrap", "--writers-stopped",
                           "--admin-hostname", "fresh.allergyevexia.in"]) == 0
    with Session(source) as db:
        user = db.query(User).one()
        assert user.is_protected_system_admin and user.system_role == "super_admin"
        assert verify_password("synthetic-fresh-install-password", user.password_hash)
        assert readiness(db) == {"status": "ready"}
        assert resolve(Response(), "fresh.allergyevexia.in", db) == {"role": "admin"}
    with pytest.raises(fresh.FreshInstallBlocked, match="already contains records"), source.begin() as db:
        fresh.finalize(db, get_settings())
    result = subprocess.run([sys.executable, "-B", str(fresh.ROOT / "scripts/deploy-migrations.py"),
                             "--backend-dir", str(fresh.BACKEND)], capture_output=True, text=True)
    assert result.returncode == 0 and '"result": "READY"' in result.stdout, result.stderr
