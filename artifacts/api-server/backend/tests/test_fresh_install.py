"""Real production guards on socket-only disposable PG, not the workspace DB."""
import fcntl
import hashlib
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
    assert len(fresh.reviewed_graph()) == 50


def simple_initialize(source, settings=None, **overrides):
    from app.initialize_database import initialize
    settings = settings or get_settings()
    with source.begin() as connection:
        name, cluster = connection.execute(text(
            "SELECT current_database(),system_identifier FROM pg_control_system()")).one()
        values = dict(database=name, cluster=cluster, host=source.url.query["host"], port=5432)
        values.update(overrides)
        initialize(connection, settings, **values)


def test_simple_install_runs_real_history_atomically_without_receipts(databases):
    from app.bootstrap import SUPER_ADMIN_EMAIL
    source, _, _ = databases
    simple_initialize(source, hostname="fresh.allergyevexia.in")
    with source.connect() as db:
        assert list(db.scalars(text("SELECT version_num FROM alembic_version"))) == [fresh.FINAL_TARGET]
        fresh.catalog(db, fresh.FINAL_TARGET)
        fresh.communication_channels(db)
        assert db.scalar(text("SELECT count(*) FROM users")) == 1
        assert db.scalar(text("SELECT to_regclass('organizations')")) is None
        assert db.scalar(text("SELECT to_regclass('memberships')")) is None
        assert db.scalar(text("SELECT hostname FROM role_hostnames")) == "fresh.allergyevexia.in"
        assert db.scalar(text("SELECT email FROM users")) != SUPER_ADMIN_EMAIL
        assert db.scalar(text("SELECT length(email_index) FROM users")) == 64
    from app.db.models import User
    from app.services.account_crypto import read, lookup, ready
    from app.api.v1.system import readiness
    from sqlalchemy import select
    with Session(source) as db:
        assert ready(db)
        assert readiness(db) == {"status": "ready"}
        user = db.scalar(select(User).where(lookup(db, SUPER_ADMIN_EMAIL.upper())))
        assert user is not None
        assert user.is_protected_system_admin and user.system_role == "super_admin" and user.is_active
        assert verify_password(get_settings().super_admin_initial_password.get_secret_value(), user.password_hash)
        assert read(user.id, "email", user.email_ciphertext, user.email_index) == SUPER_ADMIN_EMAIL
    with pytest.raises(fresh.FreshInstallBlocked, match="not pristine"):
        simple_initialize(source)


@pytest.mark.parametrize("mutation", [
    "ALTER TABLE allergen_products DROP CONSTRAINT ck_allergen_gst",
    "ALTER TABLE product_categories ALTER COLUMN unit_price TYPE numeric(18,2)",
    "ALTER TABLE allergen_products DROP CONSTRAINT ck_allergen_price; "
    "ALTER TABLE allergen_products ADD CONSTRAINT ck_allergen_price CHECK (selling_price >= 0)",
    "ALTER TABLE product_categories ADD COLUMN unrelated int",
])
def test_rate_catalog_rejects_missing_checks_changed_precision_and_extra_ddl(databases, mutation):
    source, _, _ = databases
    simple_initialize(source)
    with source.begin() as db:
        fresh.catalog(db, fresh.FINAL_TARGET)
        db.execute(text(mutation))
        with pytest.raises(fresh.FreshInstallBlocked, match="Unexpected installation catalog"):
            fresh.catalog(db, fresh.FINAL_TARGET)


@pytest.mark.parametrize("mutation", [
    "UPDATE email_templates SET name='Changed seed'",
    "UPDATE email_templates SET description='Changed seed'",
    "UPDATE email_templates SET subject='Changed seed'",
    "UPDATE email_templates SET html=html || ' '",
    "UPDATE email_templates SET text=text || ' '",
    "UPDATE email_templates SET version=2",
    "UPDATE email_templates SET updated_at=updated_at + interval '1 second'",
    "UPDATE email_templates SET updated_by=(SELECT id FROM users LIMIT 1)",
    "INSERT INTO email_templates "
    "(id,name,description,subject,html,text,event_key,version,created_by,updated_by,provenance) "
    "SELECT 'e7e80000-0000-4000-8000-000000000002','Extra','Extra','Extra','Extra','Extra',"
    "NULL,1,id,id,'administrator' FROM users LIMIT 1",
    "UPDATE pr_batch_settings SET version=2, payload_ciphertext='v1:changed'",
    "DELETE FROM pr_batch_settings",
])
def test_current_migration_owned_rows_require_exact_untouched_seeds(databases, mutation):
    source, _, _ = databases
    simple_initialize(source)
    tables = {"communication_channels", "email_templates", "pr_batch_settings"}
    with source.connect() as db:
        assert fresh.migration_owned_tables(db, tables) == tables
    with pytest.raises(fresh.FreshInstallBlocked, match="not pristine"), source.begin() as db:
        db.execute(text(mutation))
        fresh.migration_owned_tables(db, tables)


def test_current_catalog_rejects_used_receipt_number_sequence(databases):
    source, _, _ = databases
    simple_initialize(source)
    with source.begin() as db:
        db.execute(text("SELECT nextval('purchase_receipt_number_seq')"))
    with pytest.raises(fresh.FreshInstallBlocked, match="Receipt sequence"), source.connect() as db:
        fresh.catalog(db, fresh.FINAL_TARGET)


@pytest.mark.parametrize("object_sql", [
    "CREATE TABLE existing_data(id int); INSERT INTO existing_data VALUES(7)",
    "CREATE TABLE alembic_version(version_num varchar(64))",
    "CREATE SCHEMA other_app",
    "CREATE FUNCTION public.extra() RETURNS int LANGUAGE SQL AS 'SELECT 1'",
    "CREATE TYPE public.extra AS ENUM ('a','b')",
    "CREATE SEQUENCE public.extra",
    "CREATE FUNCTION pg_catalog.unexpected() RETURNS int LANGUAGE SQL AS 'SELECT 1'",
    "CREATE TEMP TABLE extra(id int)",
])
def test_simple_install_rejects_every_existing_object(databases, object_sql):
    source, _, _ = databases
    with source.begin() as db:
        db.execute(text(object_sql))
    with pytest.raises(fresh.FreshInstallBlocked):
        simple_initialize(source)
    with source.connect() as db:
        assert db.scalar(text("SELECT to_regclass('users')")) is None


@pytest.mark.parametrize("wrong", [
    {"database": "another_database"}, {"cluster": 1}, {"host": "another_host"}, {"port": 1},
])
def test_simple_install_refuses_wrong_target_before_ddl(databases, wrong):
    source, _, _ = databases
    with pytest.raises(fresh.FreshInstallBlocked):
        simple_initialize(source, **wrong)
    with source.connect() as db:
        fresh.pristine(db)


def test_simple_install_bootstrap_failure_rolls_back_entire_schema(databases):
    source, _, _ = databases
    with patch("app.bootstrap.bootstrap_super_admin", side_effect=RuntimeError("injected bootstrap failure")):
        with pytest.raises(RuntimeError, match="injected"):
            simple_initialize(source)
    with source.connect() as db:
        fresh.pristine(db)


def test_simple_install_readiness_failure_rolls_back_real_bootstrap(databases):
    from app.api.v1.system import readiness
    from app.bootstrap import SUPER_ADMIN_EMAIL
    from app.db.models import User
    from app.services.account_crypto import lookup
    from sqlalchemy import select
    source, _, _ = databases
    checked = []

    def fail_after_readiness(db):
        assert readiness(db) == {"status": "ready"}
        user = db.scalar(select(User).where(lookup(db, SUPER_ADMIN_EMAIL)))
        assert user.is_protected_system_admin
        assert db.scalar(text("SELECT count(*) FROM users")) == 1
        assert db.scalar(text("SELECT count(*) FROM role_hostnames")) == 1
        checked.append(user.id)
        raise RuntimeError("injected post-bootstrap readiness failure")

    with patch("app.api.v1.system.readiness", side_effect=fail_after_readiness):
        with pytest.raises(RuntimeError, match="injected post-bootstrap"):
            simple_initialize(source, hostname="fresh.allergyevexia.in")
    assert len(checked) == 1
    with source.connect() as db:
        fresh.pristine(db)


def test_simple_install_invalid_encryption_configuration_writes_nothing(databases):
    source, _, _ = databases
    settings = get_settings().model_copy(
        update={"communication_encryption_keys": SecretStr("invalid-json")})
    with pytest.raises(Exception):
        simple_initialize(source, settings=settings)
    with source.connect() as db:
        fresh.pristine(db)


def test_simple_install_competing_operator_is_refused(databases):
    source, _, _ = databases
    with source.connect() as blocker:
        blocker.execute(text("SELECT pg_advisory_lock(:key)"), {"key": fresh.LOCK_ID})
        try:
            with pytest.raises(fresh.FreshInstallBlocked, match="Another migration"):
                simple_initialize(source)
        finally:
            blocker.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": fresh.LOCK_ID})
    with source.connect() as db:
        fresh.pristine(db)


def test_simple_cli_commit_failure_never_claims_success_or_certain_rollback(capsys):
    from app import initialize_database as installer
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    engine = MagicMock()
    engine.begin.return_value.__exit__.side_effect = RuntimeError(
        "synthetic lost acknowledgement: 'synthetic-private-detail'")
    with patch.object(installer, "get_settings", return_value=SimpleNamespace(
            database_url="postgresql+psycopg://synthetic")), \
         patch.object(installer, "create_engine", return_value=engine), \
         patch.object(installer, "initialize"):
        assert installer.main(["--expected-database", "synthetic", "--expected-host", "postgres",
                               "--expected-system-identifier", "1"]) == 1
    captured = capsys.readouterr()
    assert "INITIALIZATION_READY" not in captured.out
    assert "do not assume rollback" in captured.err
    # An uncertain commit withholds even the primary exception: its details
    # cannot establish whether the transaction committed or rolled back.
    assert "commit/output acknowledgement not confirmed; details withheld" in captured.err
    assert "RuntimeError" not in captured.err
    assert "synthetic lost acknowledgement" not in captured.err
    assert "synthetic-private-detail" not in captured.err
    engine.dispose.assert_called_once()


def test_ordinary_alembic_still_requires_retirement_approvals_on_empty_legacy_db(databases):
    source, _, _ = databases
    with source.begin() as db:
        fresh.prepare(db)
    from app.services.organization_retirement import RetirementBlocked
    with pytest.raises(RetirementBlocked, match="approval"):
        with source.begin() as db:
            command.upgrade(fresh.alembic_config(db), "0031_remove_organizations")
    with source.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == fresh.PREPARE_TARGET
        assert db.scalar(text("SELECT to_regclass('organizations')")) is not None


def test_additive_catalog_removes_only_exact_reviewed_rows(monkeypatch):
    from app.services import fresh_catalog
    base = {"relations": [["users", "r"]], "columns": []}
    added = ["communication_channels", "r"]
    monkeypatch.setattr(fresh_catalog, "projection", lambda _: {
        "relations": base["relations"] + [added], "columns": []})
    expected = hashlib.sha256(json.dumps(
        base, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert fresh_catalog.digest(None, additions={"relations": [added]}) == expected
    with pytest.raises(ValueError, match="absent or changed"):
        fresh_catalog.digest(None, additions={"relations": [["communication_channels", "v"]]})
    monkeypatch.setattr(fresh_catalog, "projection", lambda _: {
        "relations": base["relations"] + [added, ["unreviewed", "r"]], "columns": []})
    assert fresh_catalog.digest(None, additions={"relations": [added]}) != expected


def test_missing_communication_keys_refused_before_initialization():
    from app.services.communication_crypto import CommunicationError
    settings = get_settings().model_copy(update={"communication_encryption_keys": None})
    with pytest.raises(CommunicationError):
        fresh.configuration(settings)


def test_clean_process_registers_domain_metadata():
    result = subprocess.run([sys.executable, "-B", "-c",
        "from app.db import models; from app.db.base import Base; "
        "assert {'domain_policies','purchase_orders','purchase_order_lines',"
        "'purchase_order_audit','purchase_order_requests','communication_channels',"
        "'communication_configurations'} <= set(Base.metadata.tables)"],
        check=False, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_review_rejects_changed_or_unknown_migration(tmp_path):
    shutil.copytree(fresh.ROOT / "scripts", tmp_path / "scripts",
                    ignore=shutil.ignore_patterns("__pycache__"))
    versions = tmp_path / "artifacts/api-server/backend/alembic/versions"
    shutil.copytree(fresh.BACKEND / "alembic/versions", versions)
    for path in json.loads((tmp_path / "scripts/fresh-install-review.json").read_text())["guard_sources"]:
        target = tmp_path / "artifacts/api-server/backend" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fresh.BACKEND / path, target)
    for path in json.loads((tmp_path / "scripts/fresh-install-review.json").read_text())["release_sources"]:
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fresh.ROOT / path, target)
    for relative in ("scripts/migration-policy.json",
                     "artifacts/api-server/backend/app/services/account_crypto.py",
                     "scripts/deploy-migrations.py", "scripts/fresh-install-catalog.json"):
        changed = tmp_path / relative
        original = changed.read_bytes()
        changed.write_bytes(original + b"\n")
        with pytest.raises(fresh.FreshInstallBlocked, match="review required"):
            fresh.reviewed_graph(tmp_path)
        changed.write_bytes(original)
    path = versions / "unreviewed.py"
    path.write_text("revision='unreviewed'\ndown_revision='0034_shared_phone_countries'\n")
    with pytest.raises(fresh.FreshInstallBlocked, match="review required"):
        fresh.reviewed_graph(tmp_path)
    path.unlink()
    next(versions.glob("0001*.py")).write_text("revision='0001_identity'\n")
    with pytest.raises(fresh.FreshInstallBlocked, match="review required"):
        fresh.reviewed_graph(tmp_path)


def identity_arguments(engine):
    with engine.connect() as db:
        name, identifier = db.execute(text(
            "SELECT current_database(), system_identifier FROM pg_catalog.pg_control_system()"
        )).one()
    return ["--expected-database", name, "--expected-system-identifier", str(identifier),
            "--approve-release", hashlib.sha256(
                (fresh.ROOT / "scripts/fresh-install-review.json").read_bytes()).hexdigest()]


def test_missing_identity_refused_before_connection():
    with patch.object(fresh, "create_engine") as connect:
        with pytest.raises(SystemExit) as error:
            fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped"])
        assert error.value.code == 2
        connect.assert_not_called()


def test_explicit_phase_approvals_cannot_be_reused():
    identity = ["--expected-database", "fixture", "--expected-system-identifier", "123",
                "--approve-release", "a" * 64]
    with patch.object(fresh, "verify_supervisor") as supervisor:
        assert fresh.main(["prepare", "--writers-stopped", *identity]) == 1
        assert fresh.main(["finalize", "--approve-fresh-install", "--writers-stopped", *identity]) == 1
        assert fresh.main(["prepare", "--approve-fresh-install", "--approve-bootstrap", "--writers-stopped", *identity]) == 1
        assert fresh.main(["prepare", "--approve-fresh-install", *identity]) == 1
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
    identity = identity_arguments(source)
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    with lock.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        with patch.object(fresh, "create_engine") as connect:
            assert fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped",
                               *identity[:-1], "f" * 64]) == 1
            connect.assert_not_called()
        assert fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped", *identity]) == 0
        assert fresh.main(["prepare", "--approve-fresh-install", "--writers-stopped", *identity]) == 1
    result = subprocess.run([sys.executable, "-B",
                             str(fresh.ROOT / "scripts/deploy-migrations.py"),
                             "--backend-dir", str(fresh.BACKEND)], capture_output=True, text=True)
    assert result.returncode == 42, result.stderr
    assert "OPERATOR_MIGRATION_REQUIRED" in result.stdout
    with source.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == fresh.PREPARE_TARGET


@pytest.mark.parametrize("phase", ["prepare", "finalize"])
@pytest.mark.parametrize("mismatch", ["name", "identifier", "other_cluster"])
def test_wrong_database_or_cluster_refused_before_any_mutation(databases, tmp_path, monkeypatch, phase, mismatch):
    source, rehearsal, _ = databases
    identity = identity_arguments(source)
    assert identity_arguments(rehearsal)[3] != identity[3]
    if mismatch == "name":
        identity[1] = "another_database"
    elif mismatch == "identifier":
        identity[3] = str(int(identity[3]) + 1)
    else:
        settings = get_settings().model_copy(update={"database_url": str(rehearsal.url)})
        monkeypatch.setattr(fresh, "get_settings", lambda: settings)
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    approval = "--approve-fresh-install" if phase == "prepare" else "--approve-bootstrap"
    with lock.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        with patch.object(fresh, "prepare") as prepare, patch.object(fresh, "finalize") as finalize:
            assert fresh.main([phase, approval, "--writers-stopped", *identity]) == 1
            prepare.assert_not_called()
            finalize.assert_not_called()
    assert inspect(source).get_table_names() == []
    assert inspect(rehearsal).get_table_names() == []


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


@pytest.mark.parametrize("stage", [
    "0034_shared_phone_countries", "0035_account_identifiers", "0036_reference_privacy",
    "0037_domain_admission", "0038_purchase_orders", "0039_communication", "0040_po_tax_basis",
    "0041_location_geography", "0042_rate_hundredths", "0045_pr_batch_numbers",
])
def test_independent_restore_then_real_guarded_continuation_and_atomic_bootstrap(databases, tmp_path, monkeypatch, stage):
    from app.services import organization_retirement as recovery
    from app.api.v1.system import readiness
    from app.api.v1.role_urls import resolve
    from app.db.models import User
    source, rehearsal, root = databases
    with source.begin() as db:
        fresh.prepare(db)
    custody = root / ("custody-" + stage)
    custody.mkdir(mode=0o700)
    with source.connect() as db:
        report = recovery.preflight(db)
        assert report["unexpected_dependency_count"] == 0, str(report)
        payload = recovery.snapshot(db)
        digest = recovery.save_backup(db, custody / "recovery.json")
    # A SHA alone is NOT restoration proof. Actually dump/restore into the
    # independent second cluster before any retirement approval is supplied.
    archive = custody / "predecessor.dump"
    full_archive = custody / "full-predecessor.dump"
    subprocess.run(["pg_dump", "-h", str(root / "source/socket"), "-Fc", "-f", str(full_archive),
                    "fresh_install"], check=True, capture_output=True)
    # Restore the COMPLETE archive on the independent cluster first. Keep the
    # same DB/role identity for the full recovery comparison. Do not run the
    # strict historical guard on reserialized CHECK expressions to force a pass.
    subprocess.run(["pg_restore", "-h", str(root / "rehearsal/socket"), "-d", "fresh_install",
                    "--exit-on-error", str(full_archive)], check=True, capture_output=True)
    from app.services.fresh_catalog import projection
    from app.services import fresh_recovery as full
    with source.connect() as original, rehearsal.connect() as restored:
        differences = full.compare(full.snapshot(original), full.snapshot(restored))
        assert differences["source_checks"] and differences["restored_checks"]
        assert recovery.snapshot(restored) == recovery.load_backup(custody / "recovery.json", digest)
        # Full pg_restore reserializes CHECK expressions. Compare the entire
        # data set, non-CHECK catalog, and constraint identities/validation.
        # Record the textual differences; do NOT weaken the strict live guard.
        before, after = projection(original), projection(restored)
        for category in before:
            if category == "constraints":
                assert [(r[0], r[1], r[3]) for r in before[category]] == [
                    (r[0], r[1], r[3]) for r in after[category]]
                assert [r for r in before[category] if not r[2].startswith("CHECK")] == [
                    r for r in after[category] if not r[2].startswith("CHECK")]
            else:
                assert before[category] == after[category], category
        restored_report = recovery.preflight(restored)
        assert restored_report["unexpected_dependency_count"] == 0, restored_report
        for table in inspect(original).get_table_names():
            quote = original.dialect.identifier_preparer.quote
            rows = lambda db: sorted(json.dumps(dict(row), sort_keys=True, default=str)
                for row in db.execute(text(f"SELECT * FROM {quote(table)}")).mappings())
            assert rows(original) == rows(restored), table
    recovery_lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    evidence = custody / "full-evidence.json"
    report_path = custody / "full-check-report.json"
    with recovery_lock.open("a") as handle, patch.object(fresh, "LOCK_PATH", recovery_lock):
        fcntl.flock(handle, fcntl.LOCK_EX)
        with patch.dict(os.environ, EVEXIA_DEPLOY_LOCK=str(recovery_lock),
                        EVEXIA_DEPLOY_LOCK_FD=str(handle.fileno())):
            for engine, mode in ((source, "export"), (rehearsal, "verify")):
                args = ["fresh_recovery", mode, "--evidence", str(evidence), *identity_arguments(engine)]
                if mode == "verify":
                    args += ["--sha256", hashlib.sha256(evidence.read_bytes()).hexdigest(),
                             "--catalog-report", str(report_path)]
                settings = get_settings().model_copy(update={
                    "database_url": engine.url.render_as_string(hide_password=False)})
                with patch.object(sys, "argv", args), patch.object(full, "get_settings", return_value=settings):
                    assert full.main() == 0
            assert report_path.stat().st_mode & 0o077 == 0
            # Same-cluster evidence cannot masquerade as independent recovery.
            with patch.object(sys, "argv", ["fresh_recovery", "verify", "--evidence", str(evidence),
                    "--sha256", hashlib.sha256(evidence.read_bytes()).hexdigest(),
                    "--catalog-report", str(custody / "must-not-exist.json"), *identity_arguments(source)]):
                assert full.main() == 1
            assert not (custody / "must-not-exist.json").exists()
    rehearsal.dispose()
    subprocess.run(["dropdb", "-h", str(root / "rehearsal/socket"), "fresh_install"],
                   check=True, capture_output=True)
    subprocess.run(["createdb", "-h", str(root / "rehearsal/socket"), "fresh_install"],
                   check=True, capture_output=True)
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
    # Exercise the ACTUAL shell wrapper, not a translation of its Alembic calls.
    # Relocate only the canonical path in a test-owned release copy. Production
    # has no configurable lock-path bypass. Rebind that exact reviewed test copy.
    release = tmp_path / "release"
    shutil.copytree(fresh.ROOT / "scripts", release / "scripts",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(fresh.BACKEND, release / "artifacts/api-server/backend",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(fresh.ROOT / ".github", release / ".github")
    for relative in json.loads((fresh.ROOT / "scripts/fresh-install-review.json").read_text())["release_sources"]:
        destination = release / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fresh.ROOT / relative, destination)
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    wrapper = release / "scripts/operator-retirement.sh"
    wrapper.write_text(wrapper.read_text().replace(
        "/var/www/admin-uat.allergyevexia.in/.deploy.lock", str(lock)))
    review_path = release / "scripts/fresh-install-review.json"
    review = json.loads(review_path.read_text())
    review["release_sources"]["scripts/operator-retirement.sh"] = hashlib.sha256(wrapper.read_bytes()).hexdigest()
    review_path.write_text(json.dumps(review))
    test_release_digest = hashlib.sha256(review_path.read_bytes()).hexdigest()
    # Test-only approval follows actual independent restoration; no production
    # recovery evidence or release approval is manufactured by this test.
    for engine in (rehearsal, source):
        env = dict(os.environ, DATABASE_URL=engine.url.render_as_string(hide_password=False))
        with lock.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            env.update(EVEXIA_DEPLOY_LOCK=str(lock), EVEXIA_DEPLOY_LOCK_FD=str(handle.fileno()),
                       PYTHONPATH=str(release / "artifacts/api-server/backend") +
                       os.pathsep + os.environ["PYTHONPATH"], EVEXIA_OPERATOR_PYTHON=sys.executable)
            identity = identity_arguments(engine)[:4]
            args = ["bash", str(wrapper), "--backup", str(custody / "recovery.json"),
                "--sha256", digest, "--restore-verified", digest, "--attest-restoration-rehearsal",
                "--approve-retirement", "--writers-stopped", "--external-consumers-reviewed",
                "--backup-durable", "--retention-resolved", "--approve-phone-continuation",
                "--approve-release", test_release_digest, *identity]
            if engine is source and stage == "0034_shared_phone_countries":
                def rejected(arguments, *, inherited=True):
                    failed = subprocess.run(arguments, env=env,
                        pass_fds=(handle.fileno(),) if inherited else (),
                        capture_output=True, text=True)
                    assert failed.returncode != 0
                    with source.connect() as unchanged:
                        assert unchanged.scalar(text("SELECT version_num FROM alembic_version")) == fresh.PREPARE_TARGET
                        assert unchanged.scalar(text("SELECT count(*) FROM users")) == 0
                rejected(args + ["--expected-database", "wrong_target"])
                rejected(args + ["--expected-system-identifier", identity_arguments(rehearsal)[3]])
                rejected(args + ["--approve-release", "f" * 64])
                rejected([a for a in args if a != "--approve-phone-continuation"])
                rejected(args, inherited=False)
                (tmp_path / ".operator-maintenance").unlink()
                rejected(args)
                (tmp_path / ".operator-maintenance").touch()
                policy = release / "scripts/migration-policy.json"
                original = policy.read_bytes()
                policy.write_bytes(original + b"\n")
                rejected(args)
                policy.write_bytes(original)
                unknown = release / "artifacts/api-server/backend/alembic/versions/unreviewed.py"
                unknown.write_text("revision='unreviewed'\ndown_revision='0038_purchase_orders'\n")
                rejected(args)
                unknown.unlink()
            result = subprocess.run(args,
                env=env, pass_fds=(handle.fileno(),), capture_output=True, text=True)
            assert result.returncode == 0, result.stdout + result.stderr
        with engine.begin() as db:
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0034_shared_phone_countries"
            assert not db.scalar(text("SELECT to_regclass('purchase_order_number_seq')"))
            fresh.catalog(db, "0034_shared_phone_countries")
            config = fresh.alembic_config(db)
            command.upgrade(config, stage)
            fresh.catalog(db, stage)
            has_po = stage in ("0038_purchase_orders", "0039_communication",
                               "0040_po_tax_basis", "0041_location_geography", fresh.FINAL_TARGET)
            assert ("purchase_orders" in inspect(db).get_table_names()) == has_po
            assert bool(db.scalar(text("SELECT to_regclass('purchase_order_number_seq')"))) == has_po
    if stage in ("0038_purchase_orders", "0039_communication", "0040_po_tax_basis",
                 "0041_location_geography", fresh.FINAL_TARGET):
        # Consume only the disposable rehearsal's sequence. Never reset it to
        # disguise use; leave that independent test database blocked.
        with rehearsal.begin() as db:
            assert db.scalar(text("SELECT nextval('purchase_order_number_seq')")) == 1
        with pytest.raises(fresh.FreshInstallBlocked, match="sequence is not unused"), rehearsal.begin() as db:
            fresh.finalize(db, get_settings())
        with rehearsal.connect() as db:
            assert db.scalar(text("SELECT count(*) FROM users")) == 0
    # Every admitted predecessor refuses populated data or altered catalogs
    # before changing revision, account, or credentials. Roll back test mutations.
    mutations = [
        "CREATE TABLE unrelated(id int)", "CREATE VIEW unrelated AS SELECT 1 AS id",
        "CREATE SEQUENCE unrelated", "CREATE TYPE unrelated AS ENUM ('x')",
        "CREATE FUNCTION unrelated() RETURNS integer LANGUAGE SQL AS 'SELECT 1'",
        "ALTER TABLE users ADD COLUMN unrelated int",
        "INSERT INTO login_attempts(id,identifier_hash,attempted_at) VALUES "
        "('00000000-0000-0000-0000-000000000001','synthetic',now())",
    ]
    if stage == fresh.FINAL_TARGET:
        mutations += [
            "UPDATE communication_channels SET version=2 WHERE channel='email'",
            "DELETE FROM communication_channels WHERE channel='sms'",
            "ALTER TABLE communication_configurations DROP CONSTRAINT ck_comm_encrypted",
            "DROP INDEX uq_comm_default",
        ]
    for sql in mutations:
        with pytest.raises(fresh.FreshInstallBlocked), source.begin() as db:
            db.execute(text(sql))
            fresh.finalize(db, get_settings())
        with source.connect() as db:
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == stage
            assert db.scalar(text("SELECT count(*) FROM users")) == 0
    with pytest.raises(RuntimeError), source.begin() as db:
        fresh.finalize(db, get_settings(), "fresh.allergyevexia.in")
        raise RuntimeError("Synthetic failure after bootstrap; outer transaction still owns commit")
    with source.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == stage
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
                           "--admin-hostname", "fresh.allergyevexia.in", *identity_arguments(source)]) == 0
        # Simulate a lost successful acknowledgement: a retry with a different
        # configured initial password must refuse, never reset the committed one.
        replacement = get_settings().model_copy(update={
            "super_admin_initial_password": SecretStr("different-synthetic-password")})
        with patch.object(fresh, "get_settings", return_value=replacement):
            assert fresh.main(["finalize", "--approve-bootstrap", "--writers-stopped",
                               *identity_arguments(source)]) == 1
    with Session(source) as db:
        user = db.query(User).one()
        assert user.is_protected_system_admin and user.system_role == "super_admin"
        assert verify_password("synthetic-fresh-install-password", user.password_hash)
        assert readiness(db) == {"status": "ready"}
        fresh.communication_channels(db)
        assert db.scalar(text("SELECT count(*) FROM communication_configurations")) == 0
        from starlette.requests import Request
        monkeypatch.setenv("PORTAL_BOOTSTRAP_HOSTS", "fresh.allergyevexia.in")
        get_settings.cache_clear()
        request = Request({"type": "http", "state": {"accepted_hostname": "fresh.allergyevexia.in"}})
        # Operator recovery approval never activates the legacy Admin mapping.
        assert resolve(request, Response(), "fresh.allergyevexia.in", db) == {"role": None}
        assert db.scalar(text("SELECT count(*) FROM domain_policies")) == 0
    with pytest.raises(fresh.FreshInstallBlocked, match="already contains records"), source.begin() as db:
        fresh.finalize(db, get_settings())
    result = subprocess.run([sys.executable, "-B", str(fresh.ROOT / "scripts/deploy-migrations.py"),
                             "--backend-dir", str(fresh.BACKEND)], capture_output=True, text=True)
    assert result.returncode == 0 and '"result": "READY"' in result.stdout, result.stderr


@pytest.mark.parametrize("contents", [
    None,
    "CREATE TABLE existing_application_data(id integer); INSERT INTO existing_application_data VALUES (1)",
    "CREATE SCHEMA unrelated",
    "CREATE TYPE public.existing_enum AS ENUM ('existing')",
    "CREATE TABLE alembic_version(version_num text)",
    "CREATE TEXT SEARCH CONFIGURATION public.unrelated (COPY=pg_catalog.simple)",
    "CREATE FOREIGN DATA WRAPPER unrelated",
    "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
    "CREATE PUBLICATION unrelated FOR ALL TABLES",
    "MISMATCH_DATABASE",
    "MISMATCH_CLUSTER",
])
def test_machine_prepare_requires_live_pristine_proof(databases, tmp_path, monkeypatch, contents):
    """Synthetic authorities exercise authorization; real isolated PG exercises DDL."""
    import importlib.util
    helper_spec = importlib.util.spec_from_file_location(
        "synthetic_release_evidence", fresh.ROOT / "scripts/tests/test_release_authorization.py")
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    from sqlalchemy.engine import make_url
    source, _, _ = databases
    with source.connect() as db:
        database, cluster = db.execute(text(
            "SELECT current_database(),system_identifier FROM pg_catalog.pg_control_system()")).one()
    settings = get_settings()
    proof = helper.evidence(fresh.ROOT, tmp_path, settings, database, cluster)
    proof.config["database_host"] = make_url(settings.database_url).query["host"]
    if contents == "MISMATCH_DATABASE":
        proof.config["database"] = proof.recovery["database"] = "wrong_database"
    if contents == "MISMATCH_CLUSTER":
        proof.config["cluster"] = proof.recovery["cluster"] = cluster + 10
    helper.sign(proof.recovery_receipt, proof.recovery, proof.recovery_key)
    helper.private_json(proof.trust_file, proof.config)
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    monkeypatch.setattr(fresh, "LOCK_PATH", lock)
    monkeypatch.setenv("EVEXIA_DEPLOY_LOCK", str(lock))
    if contents and not contents.startswith("MISMATCH_"):
        with source.begin() as db:
            db.execute(text(contents))
    state = tmp_path / "fresh-origin.json"
    arguments = [
        "--writers-stopped", "--expected-database", database,
        "--expected-system-identifier", str(cluster),
        "--validated-release", str(proof.receipt), "--trust-config", str(proof.trust_file),
        "--recovery-evidence", str(proof.recovery_receipt), "--fresh-state", str(state),
    ]
    with lock.open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        monkeypatch.setenv("EVEXIA_DEPLOY_LOCK_FD", str(handle.fileno()))
        assert fresh.main(["prepare", *arguments]) == (1 if contents else 0)
        assert state.exists() is (contents is None)
        if contents is None:
            with source.connect() as db:
                assert db.scalar(text("SELECT version_num FROM alembic_version")) == fresh.PREPARE_TARGET
            # Even authenticated preparation does NOT bypass the retirement cap.
            assert fresh.main(["finalize", *arguments]) == 1
        else:
            with patch.object(fresh, "finalize") as bootstrap:
                assert fresh.main(["finalize", *arguments]) == 1
                bootstrap.assert_not_called()


def test_machine_fresh_path_rehearses_then_runs_original_retirement_and_bootstrap(databases, tmp_path, monkeypatch):
    """Real empty backup/independent restore; test authorities sign only test facts."""
    import importlib.util
    from app.services import organization_retirement as recovery
    from app.services import release_authorization as auth
    helper_spec = importlib.util.spec_from_file_location(
        "machine_path_evidence", fresh.ROOT / "scripts/tests/test_release_authorization.py")
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    source, rehearsal, pgroot = databases
    # Pin a test-only release copy solely to relocate the canonical host lock.
    release = tmp_path / "release"
    shutil.copytree(fresh.ROOT / "scripts", release / "scripts",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(fresh.BACKEND, release / "artifacts/api-server/backend",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(fresh.ROOT / ".github", release / ".github")
    for relative in json.loads((fresh.ROOT / "scripts/fresh-install-review.json").read_text())["release_sources"]:
        destination = release / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fresh.ROOT / relative, destination)
    lock = tmp_path / ".deploy.lock"
    (tmp_path / ".operator-maintenance").touch()
    wrapper = release / "scripts/operator-retirement.sh"
    wrapper.write_text(wrapper.read_text().replace(
        "/var/www/admin-uat.allergyevexia.in/.deploy.lock", str(lock)))
    copied_fresh = release / "artifacts/api-server/backend/app/fresh_install.py"
    copied_fresh.write_text(copied_fresh.read_text().replace(
        "/var/www/admin-uat.allergyevexia.in/.deploy.lock", str(lock)))
    review_file = release / "scripts/fresh-install-review.json"
    review = json.loads(review_file.read_text())
    review["release_sources"]["scripts/operator-retirement.sh"] = auth.sha(wrapper)
    review["release_sources"]["artifacts/api-server/backend/app/fresh_install.py"] = auth.sha(copied_fresh)
    review_file.write_text(json.dumps(review))
    archive = tmp_path / "pristine.dump"
    subprocess.run(["pg_dump", "-h", str(pgroot / "source/socket"), "-Fc",
                    "-f", str(archive), "fresh_install"], check=True, capture_output=True)
    archive.chmod(0o600)
    subprocess.run(["pg_restore", "-h", str(pgroot / "rehearsal/socket"),
                    "-d", "fresh_install", "--exit-on-error", str(archive)],
                   check=True, capture_output=True)
    with source.connect() as db:
        fresh.pristine(db)
        database, cluster = db.execute(text(
            "SELECT current_database(),system_identifier FROM pg_catalog.pg_control_system()")).one()
    with rehearsal.begin() as db:
        fresh.pristine(db)
        restored_cluster = db.scalar(text("SELECT system_identifier FROM pg_catalog.pg_control_system()"))
        assert restored_cluster != cluster
        fresh.prepare(db)
    organization_file = tmp_path / "organization.json"
    with rehearsal.connect() as db:
        organization_sha = recovery.save_backup(db, organization_file)
    settings = get_settings()
    proof = helper.evidence(release, tmp_path, settings, database, cluster)
    proof.config["database_host"] = str(pgroot / "source/socket")
    helper.private_json(proof.trust_file, proof.config)
    proof.recovery.update(restored_cluster=restored_cluster, backup_path=str(archive),
                          backup_sha256=auth.sha(archive),
                          organization_recovery_path=str(organization_file),
                          organization_recovery_sha256=organization_sha)
    helper.sign(proof.recovery_receipt, proof.recovery, proof.recovery_key)
    state = tmp_path / "pristine-origin.json"
    common = ["--writers-stopped", "--expected-database", database,
        "--expected-system-identifier", str(cluster), "--validated-release", str(proof.receipt),
        "--trust-config", str(proof.trust_file), "--recovery-evidence", str(proof.recovery_receipt),
        "--fresh-state", str(state)]
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        env = dict(os.environ, EVEXIA_DEPLOY_LOCK=str(lock),
                   EVEXIA_DEPLOY_LOCK_FD=str(handle.fileno()),
                   EVEXIA_OPERATOR_PYTHON=sys.executable,
                   PYTHONPATH=str(release / "artifacts/api-server/backend") + os.pathsep + os.environ["PYTHONPATH"])
        def run(arguments):
            result = subprocess.run(arguments, env=env, pass_fds=(handle.fileno(),),
                                    capture_output=True, text=True)
            assert result.returncode == 0, result.stdout + result.stderr
        clone_environment = dict(env, DATABASE_URL=rehearsal.url.render_as_string(hide_password=False))
        cloned = subprocess.run([
            "bash", str(wrapper), "--writers-stopped",
            "--expected-database", database, "--expected-system-identifier", str(restored_cluster),
            "--approve-release", auth.sha(review_file),
            "--backup", str(organization_file), "--sha256", organization_sha,
            "--restore-verified", organization_sha, "--attest-restoration-rehearsal",
            "--approve-retirement", "--external-consumers-reviewed", "--backup-durable",
            "--retention-resolved", "--approve-phone-continuation",
        ], env=clone_environment, pass_fds=(handle.fileno(),), capture_output=True, text=True)
        assert cloned.returncode == 0, cloned.stdout + cloned.stderr
        helper.private_json(Path(proof.recovery["restoration_report_path"]), {
            "restored_cluster": restored_cluster, "source_cluster": cluster,
            "restoration_exit": 0, "guarded_rehearsal_exit": cloned.returncode,
        })
        proof.recovery["restoration_report_sha256"] = auth.sha(proof.recovery["restoration_report_path"])
        helper.sign(proof.recovery_receipt, proof.recovery, proof.recovery_key)
        run([sys.executable, "-B", "-m", "app.fresh_install", "prepare", *common])
        run(["bash", str(wrapper), *common, "--backup", str(organization_file),
             "--sha256", organization_sha, "--restore-verified", organization_sha,
             "--attest-restoration-rehearsal", "--approve-retirement",
             "--external-consumers-reviewed", "--backup-durable", "--retention-resolved",
             "--approve-phone-continuation"])
        with source.connect() as db:
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0034_shared_phone_countries"
            assert db.scalar(text("SELECT count(*) FROM users")) == 0
        # Bootstrap permission is separately configured, not inferred from release success.
        proof.config["allow_initial_bootstrap"] = False
        helper.private_json(proof.trust_file, proof.config)
        denied = subprocess.run([sys.executable, "-B", "-m", "app.fresh_install", "finalize", *common],
                                env=env, pass_fds=(handle.fileno(),), capture_output=True)
        assert denied.returncode != 0
        proof.config["allow_initial_bootstrap"] = True
        helper.private_json(proof.trust_file, proof.config)
        run([sys.executable, "-B", "-m", "app.fresh_install", "finalize", *common])
        # A populated install cannot silently bootstrap again.
        denied = subprocess.run([sys.executable, "-B", "-m", "app.fresh_install", "finalize", *common],
                                env=env, pass_fds=(handle.fileno(),), capture_output=True)
        assert denied.returncode != 0
    with source.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == fresh.FINAL_TARGET
        assert db.scalar(text("SELECT count(*) FROM users")) == 1
        assert "organizations" not in inspect(db).get_table_names()
        fresh.communication_channels(db)
