#!/usr/bin/env python3
"""Explicit, original-development-only 0044 -> 0045 recovery and activation."""
import argparse
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"
sys.path.insert(0, str(BACKEND))
PREDECESSOR = "0044_purchase_received"
TARGET = "0045_pr_batch_numbers"
WORKSPACE = "9bd1d1ea-b7fe-4e8b-8aa6-02e5591a96a0"
BINDING = {"version": 1, "host": "helium", "port": 5432, "database": "heliumdb",
           "cluster": "7689828272860483604", "oid": 16384}
NEW_TABLES = ("pr_batch_settings", "pr_batch_counters", "pr_batch_allocations")


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def check_approval(args, settings):
    require(args.approve_0044_to_0045 and args.attest_key_recovery and args.writers_stopped,
            "Exact path approval, independently recoverable keys and stopped writers required")
    require(settings.app_env == "development" and os.environ.get("REPL_ID") == WORKSPACE,
            "Only the original development workspace is authorized")


def reviewed_plan(sync):
    runner, graph, policy, target, _ = sync.source_review(ROOT)
    require(target == TARGET, "Reviewed target changed; no expanded approval")
    plan = runner.plan(graph, policy, [PREDECESSOR], TARGET)
    require(plan["pending"] == [TARGET] and plan["operator_only"] == [TARGET],
            "Exact operator-only 0044 to 0045 path required")
    require(json.loads((ROOT / "scripts/development-database.json").read_text()) == BINDING,
            "Independently approved database binding changed")


def original_inventory(raw, helpers):
    """No exclusions within business rows: every original column remains exact."""
    return {table: state for table, state in helpers.inventory(raw).items()
            if table not in {"public.alembic_version",
                             *(f"public.{table}" for table in NEW_TABLES)}}


def postconditions(raw, helpers, before):
    require(original_inventory(raw, helpers) == before,
            "Existing table contents changed; activation refused")
    require(raw.execute("SELECT version_num FROM public.alembic_version").fetchall()
            == [(TARGET,)], "Exact target revision required")
    require(raw.execute("SELECT id,version,payload_ciphertext FROM public.pr_batch_settings").fetchall()
            == [(1, 1, None)], "Initial Manual settings marker differs")
    for table in NEW_TABLES[1:]:
        require(raw.execute(f"SELECT count(*) FROM public.{table}").fetchone()[0] == 0,
                "New batch allocation/counter tables must remain empty")


def upgrade(connection):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.orm import Session
    from app.api.v1.system import readiness
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.attributes["connection"] = connection
    command.upgrade(config, TARGET)
    with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
        readiness(db)


def activate(args):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    from psycopg import sql
    from app.core.config import get_settings
    from app.services.purchase_received_crypto import ReceiptCrypto

    settings = get_settings()
    check_approval(args, settings)
    ReceiptCrypto(settings)
    sync = module("batch_activation_sync", ROOT / "scripts/development-sync.py")
    helpers = module("batch_recovery_helpers", ROOT / "scripts/activate-purchase-orders-development.py")
    recovery_checks = module("batch_recovery_checks", ROOT / "scripts/activate-development-0044.py")
    reviewed_plan(sync)
    pinned = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
        "scripts/development-schema-review.json", "scripts/activate-development-0045.py",
        "scripts/activate-development-0044.py", "scripts/activate-purchase-orders-development.py")}

    def verify_source():
        reviewed_plan(sync)
        require(all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest
                    for path, digest in pinned.items()), "Reviewed recovery source changed")

    storage = helpers.PrivateRecovery(scope="development-0045")
    os.umask(0o077)
    recovery = Path(tempfile.mkdtemp(prefix="evexia-development-0045-", dir="/tmp"))
    print(f"RECOVERY_DIRECTORY: {recovery}", flush=True)
    log = (recovery / "tools.log").open("wb")
    engine = create_engine(settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1),
                           hide_parameters=True)
    started = False
    committed = False

    def run(command, env=None):
        subprocess.run(command, env=env, stdout=log, stderr=log, check=True, timeout=300)

    try:
        with engine.connect() as connection:
            with connection.begin():
                connection.exec_driver_sql("SET LOCAL lock_timeout='10s'")
                connection.exec_driver_sql("SET LOCAL statement_timeout='120s'")
                connection.exec_driver_sql("SET LOCAL TIME ZONE 'UTC'")
                sync.target_matches(settings, connection, BINDING)
                require(connection.exec_driver_sql("SELECT pg_try_advisory_xact_lock(145002)").scalar_one(),
                        "Another development operator is active")
                raw = connection.connection.driver_connection
                recovery_checks.verify_postgres_tools(int(raw.execute("SHOW server_version_num").fetchone()[0]))
                require(raw.execute("SELECT version_num FROM public.alembic_version").fetchall()
                        == [(PREDECESSOR,)], "Exact 0044 predecessor required; no blind replay")
                require(not raw.execute("SELECT 1 FROM pg_class WHERE relname=ANY(%s)",
                                        (list(NEW_TABLES),)).fetchall(),
                        "Partial batch objects require independent review")
                tables = raw.execute(
                    "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN "
                    "('pg_catalog','information_schema') ORDER BY 1,2").fetchall()
                raw.execute(sql.SQL("LOCK TABLE {} IN SHARE MODE").format(
                    sql.SQL(",").join(sql.Identifier(*table) for table in tables)))
                sync.target_matches(settings, connection, BINDING)
                require(raw.execute("SELECT count(*) FROM pg_largeobject_metadata").fetchone()[0] == 0,
                        "Large objects need a separately reviewed recovery inventory")
                snapshot = raw.execute("SELECT pg_export_snapshot()").fetchone()[0]
                original = helpers.inventory(raw)
                before = original_inventory(raw, helpers)
                env = dict(os.environ, PGHOST=raw.info.host, PGPORT=str(raw.info.port),
                           PGDATABASE=raw.info.dbname, PGUSER=raw.info.user)
                if raw.info.password:
                    env["PGPASSWORD"] = raw.info.password
                backup = recovery / "before-0045.dump"
                run(["pg_dump", "--format=custom", "--snapshot", snapshot, "--file", str(backup)], env)
                run(["pg_restore", "--list", str(backup)])
                original_schema = recovery / "original-schema.sql"
                run(["pg_restore", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(original_schema), str(backup)])
                backup_evidence = storage.retain(backup, recovery.name)
                print("PRIVATE_BACKUP_VERIFIED: readback hash matched; anonymous access denied", flush=True)
                socket = recovery / "socket"
                socket.mkdir(mode=0o700)
                data = recovery / "restored-cluster"
                run(["initdb", "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8"])
                run(["pg_ctl", "-D", str(data), "-l", str(recovery / "postgres.log"),
                     "-o", f"-k {socket} -p 55432 -c listen_addresses=''", "-w", "start"])
                started = True
                restore_env = dict(os.environ, PGHOST=str(socket), PGPORT="55432",
                                   PGUSER=getpass.getuser(), PGDATABASE="development_recovery")
                restore_env.pop("PGPASSWORD", None)
                run(["createdb"], restore_env)
                run(["pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                     "--dbname", "development_recovery", str(backup)], restore_env)
                restored_schema = recovery / "restored-schema.sql"
                run(["pg_dump", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(restored_schema)], restore_env)
                schema_env = dict(restore_env, PGDATABASE="schema_reference")
                run(["createdb"], schema_env)
                run(["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
                     "--file", str(original_schema)], schema_env)
                canonical_schema = recovery / "canonical-original-schema.sql"
                run(["pg_dump", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(canonical_schema)], schema_env)
                require(recovery_checks.schema_digest(canonical_schema)
                        == recovery_checks.schema_digest(restored_schema),
                        "Restored schema differs; original database unchanged")
                restored_engine = create_engine(URL.create(
                    "postgresql+psycopg", username=getpass.getuser(), database="development_recovery",
                    query={"host": str(socket), "port": "55432"}), hide_parameters=True)
                try:
                    with restored_engine.begin() as restored:
                        restored.exec_driver_sql("SET LOCAL TIME ZONE 'UTC'")
                        restored_raw = restored.connection.driver_connection
                        require(restored_raw.execute(
                            "SELECT system_identifier::text FROM pg_control_system()").fetchone()[0]
                            != BINDING["cluster"], "Restoration is not independent")
                        require(helpers.inventory(restored_raw) == original,
                                "Full restored table contents differ")
                        require(restored_raw.execute("SELECT version_num FROM public.alembic_version").fetchall()
                                == [(PREDECESSOR,)], "Restored predecessor differs")
                        restored.exec_driver_sql("SELECT pg_advisory_xact_lock(145002)")
                        verify_source()
                        upgrade(restored)
                        postconditions(restored_raw, helpers, before)
                finally:
                    restored_engine.dispose()
                report = {
                    "scope": "original development only", "from": PREDECESSOR, "to": TARGET,
                    "database": BINDING, "source_sha256": pinned,
                    "backup": backup_evidence, "independent_restoration": True,
                    "complete_schema_match": True, "all_original_rows_and_columns_match": True,
                    "tables_checked": len(original), "rows_checked": sum(v["rows"] for v in original.values()),
                    "exact_path_rehearsal": "passed", "pr_key_configuration": "valid",
                    "key_recovery": "Previously confirmed separate private key recovery retained",
                    "status": "rehearsal_complete_not_yet_activated",
                }
                evidence = recovery / "recovery.json"
                evidence.write_text(json.dumps(report, indent=2) + "\n")
                storage.retain(evidence, recovery.name)
                print("RESTORATION_AND_REHEARSAL_PASSED: full schema/data; exact 0045; readiness", flush=True)
                verify_source()
                sync.target_matches(settings, connection, BINDING)
                require(raw.execute("SELECT version_num FROM public.alembic_version").fetchall()
                        == [(PREDECESSOR,)], "Predecessor changed")
                upgrade(connection)
                postconditions(raw, helpers, before)
            committed = True
            with connection.begin():
                sync.target_matches(settings, connection, BINDING)
                require(connection.exec_driver_sql("SELECT version_num FROM public.alembic_version").all()
                        == [(TARGET,)], "Committed revision unverified; do not replay")
        report["status"] = "activation_committed"
        evidence = recovery / "activation.json"
        evidence.write_text(json.dumps(report, indent=2) + "\n")
        storage.retain(evidence, recovery.name)
        print(json.dumps(report), flush=True)
        return 0
    except Exception:
        print("ACTIVATION_NOT_CONFIRMED: precommit failures roll back. Inspect private "
              "recovery evidence and database read-only before replay or restoration; "
              f"commit acknowledgement observed: {committed}. A failed acknowledgement "
              "is not proof of rollback.", file=sys.stderr)
        raise
    finally:
        if started:
            subprocess.run(["pg_ctl", "-D", str(recovery / "restored-cluster"),
                            "-m", "fast", "-w", "stop"], stdout=log, stderr=log, timeout=60)
        log.close()
        engine.dispose()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--approve-0044-to-0045", action="store_true", required=True)
    result.add_argument("--attest-key-recovery", action="store_true", required=True)
    result.add_argument("--writers-stopped", action="store_true", required=True)
    return result


if __name__ == "__main__":
    try:
        raise SystemExit(activate(parser().parse_args()))
    except Exception as exc:
        from app.services.initialization_diagnostics import exception_diagnostic
        print("DEVELOPMENT_ACTIVATION_BLOCKED: " + exception_diagnostic(exc), file=sys.stderr)
        raise SystemExit(1)
