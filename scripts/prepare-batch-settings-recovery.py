#!/usr/bin/env python3
"""Development 0044 backup/restoration and disposable 0045 rehearsal ONLY.

Never migrates the configured database. No activation mode, bootstrap, key export,
source-review runner, startup hook, release checks or production operations.
"""
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
BINDING = {"version": 1, "host": "helium", "port": 5432, "database": "heliumdb",
           "cluster": "7689828272860483604", "oid": 16384}
MIGRATION_SHA = "bcdf222f4ef8f60e9c01bb3f37558fd75fe331e828f17398bdaae1681d4923ef"
ENV_SHA = "53ebac96cb7e80536bb993f17652dfc65a3e5c68b9efbcecc343571fd544e354"
TABLES = ("pr_batch_settings", "pr_batch_counters", "pr_batch_allocations")


def require(value, message):
    if not value:
        raise RuntimeError(message)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    require(sys.argv[1:] == ["--approve-development-backup-and-rehearsal"],
            "Explicit development backup/rehearsal approval required")
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.orm import Session
    from psycopg import sql
    from app.core.config import get_settings
    from app.services.purchase_received_crypto import ReceiptCrypto
    from app.api.v1.system import readiness

    settings = get_settings()
    require(settings.app_env == "development", "Development only")
    ReceiptCrypto(settings)  # Configuration validation, not key-recovery evidence.
    require(json.loads((ROOT / "scripts/development-database.json").read_text()) == BINDING,
            "Independently reviewed target binding changed")
    require(json.loads((ROOT / "development-contract.json").read_text())["schema"] == TARGET,
            "Reviewed candidate changed; coordinate inventory ownership")
    require(digest(BACKEND / "alembic/versions/0045_pr_batch_numbers.py") == MIGRATION_SHA
            and digest(BACKEND / "alembic/env.py") == ENV_SHA,
            "Reviewed migration/environment changed")
    # Import only established recovery utilities. Never invoke either predecessor
    # activation entry point or extend its permitted migration path.
    helpers = module("batch_backup_helpers", ROOT / "scripts/activate-purchase-orders-development.py")
    prior = module("batch_restore_helpers", ROOT / "scripts/activate-development-0044.py")
    frozen = {p: digest(p) for p in (
        ROOT / "development-contract.json", ROOT / "scripts/development-schema-review.json",
        ROOT / "scripts/prepare-batch-settings-recovery.py",
        ROOT / "scripts/activate-purchase-orders-development.py",
        ROOT / "scripts/activate-development-0044.py", BACKEND / "alembic/env.py",
        *sorted((BACKEND / "alembic/versions").glob("*.py")),
        *sorted((BACKEND / "app").rglob("*.py")),
    )}

    def unchanged():
        require(all(digest(p) == sha for p, sha in frozen.items()), "Source changed during recovery")

    class BatchRecovery(helpers.PrivateRecovery):
        def __init__(self):
            super().__init__()
            # The inherited class is a private storage transport only. Give this
            # new backup its own namespace; do not alter predecessor runner gates.
            self.scope = "development-0045"

    storage = BatchRecovery()
    os.umask(0o077)
    recovery = Path(tempfile.mkdtemp(prefix="evexia-batch-recovery-", dir="/tmp"))
    print(f"PRIVATE_RECOVERY_DIRECTORY: {recovery}", flush=True)
    log = (recovery / "tools.log").open("wb")
    started = False
    engine = create_engine(settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1),
                           hide_parameters=True, connect_args={"connect_timeout": 5})

    def run(args, env=None):
        subprocess.run(args, env=env, stdout=log, stderr=log, check=True, timeout=300)

    def target(raw):
        row = raw.execute(
            "SELECT current_database(), (SELECT system_identifier::text FROM pg_control_system()), "
            "(SELECT oid FROM pg_database WHERE datname=current_database()), pg_is_in_recovery()").fetchone()
        require((raw.info.host, raw.info.port, *row) ==
                (BINDING["host"], BINDING["port"], BINDING["database"], BINDING["cluster"], BINDING["oid"], False),
                "Approved development target differs")
        require(raw.execute("SELECT version_num FROM public.alembic_version").fetchall() == [(PREDECESSOR,)],
                "Exact predecessor required; no racing/downgrading a newer release")

    try:
        with engine.connect() as source:
            # Only SELECT/LOCK/SET on the configured target. SHARE locks exclude
            # writers during the snapshot; the standard operator mutex excludes
            # another cooperating activation while evidence is collected.
            with source.begin():
                source.exec_driver_sql("SET LOCAL lock_timeout='10s'")
                source.exec_driver_sql("SET LOCAL statement_timeout='120s'")
                raw = source.connection.driver_connection
                target(raw)
                require(raw.execute("SELECT pg_try_advisory_xact_lock(145002)").fetchone()[0],
                        "Another migration operator is active")
                prior.verify_postgres_tools(int(raw.execute("SHOW server_version_num").fetchone()[0]))
                require(raw.execute("SELECT count(*) FROM pg_largeobject_metadata").fetchone()[0] == 0,
                        "Large-object recovery needs separate review")
                require(not raw.execute("SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace "
                                        "AND relname=ANY(%s)", (list(TABLES),)).fetchall(),
                        "Partial successor objects require separate review")
                tables = raw.execute(
                    "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN "
                    "('pg_catalog','information_schema') ORDER BY 1,2").fetchall()
                raw.execute(sql.SQL("LOCK TABLE {} IN SHARE MODE").format(
                    sql.SQL(",").join(sql.Identifier(*row) for row in tables)))
                target(raw)
                unchanged()
                snapshot = raw.execute("SELECT pg_export_snapshot()").fetchone()[0]
                original = helpers.inventory(raw)
                env = dict(os.environ, PGHOST=raw.info.host, PGPORT=str(raw.info.port),
                           PGDATABASE=raw.info.dbname, PGUSER=raw.info.user)
                if raw.info.password:
                    env["PGPASSWORD"] = raw.info.password
                backup = recovery / "before-0045.dump"
                run(["pg_dump", "--format=custom", "--snapshot", snapshot, "--file", str(backup)], env)
                run(["pg_restore", "--list", str(backup)])
                backup_evidence = storage.retain(backup, recovery.name)
                print("PRIVATE_BACKUP_VERIFIED: authenticated readback; anonymous access denied", flush=True)
                original_schema = recovery / "original-schema.sql"
                run(["pg_restore", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(original_schema), str(backup)])
                socket = recovery / "socket"
                socket.mkdir(mode=0o700)
                data = recovery / "restored-cluster"
                run(["initdb", "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8"])
                run(["pg_ctl", "-D", str(data), "-l", str(recovery / "postgres.log"),
                     "-o", f"-k {socket} -p 55435 -c listen_addresses=''", "-w", "start"])
                started = True
                local = dict(os.environ, PGHOST=str(socket), PGPORT="55435",
                             PGUSER=getpass.getuser(), PGDATABASE="batch_recovery")
                local.pop("PGPASSWORD", None)
                run(["createdb"], local)
                run(["pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                     "--dbname", "batch_recovery", str(backup)], local)
                restored_schema = recovery / "restored-schema.sql"
                run(["pg_dump", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(restored_schema)], local)
                reference = dict(local, PGDATABASE="schema_reference")
                run(["createdb"], reference)
                run(["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
                     "--file", str(original_schema)], reference)
                canonical_schema = recovery / "canonical-original-schema.sql"
                run(["pg_dump", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(canonical_schema)], reference)
                require(prior.schema_digest(canonical_schema) == prior.schema_digest(restored_schema),
                        "Complete restored schema differs")
                restored_engine = create_engine(URL.create(
                    "postgresql+psycopg", username=getpass.getuser(), database="batch_recovery",
                    query={"host": str(socket), "port": "55435"}), hide_parameters=True)
                try:
                    with restored_engine.begin() as restored:
                        restored_raw = restored.connection.driver_connection
                        require(restored_raw.execute(
                            "SELECT system_identifier::text FROM pg_control_system()").fetchone()[0] != BINDING["cluster"],
                            "Restoration is not independent")
                        require(helpers.inventory(restored_raw) == original, "Complete restored table contents differ")
                        unchanged()
                        # Only THIS disposable connection is ever passed to Alembic.
                        cfg = Config(str(BACKEND / "alembic.ini"))
                        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
                        cfg.attributes["connection"] = restored
                        command.upgrade(cfg, TARGET)
                        require(restored_raw.execute("SELECT version_num FROM alembic_version").fetchall() == [(TARGET,)],
                                "Rehearsed target differs")
                        after = helpers.inventory(restored_raw)
                        require(set(after) == set(original) | {f"public.{t}" for t in TABLES},
                                "Unexpected rehearsal table changes")
                        require(all(after[t] == value for t, value in original.items()
                                    if t != "public.alembic_version"), "Historical rows changed")
                        require(restored_raw.execute(
                            "SELECT id,version,payload_ciphertext FROM pr_batch_settings").fetchall() == [(1, 1, None)],
                            "Exact initial batch configuration differs")
                        require(all(restored_raw.execute(f"SELECT count(*) FROM {t}").fetchone()[0] == 0
                                    for t in TABLES[1:]), "Rehearsal counters/history not empty")
                        with Session(bind=restored, join_transaction_mode="create_savepoint") as db:
                            require(readiness(db) == {"status": "ready"}, "Rehearsal readiness failed")
                finally:
                    restored_engine.dispose()
                target(raw)
                unchanged()
                require(helpers.inventory(raw) == original, "Source changed during backup/rehearsal")
                report = {
                    "scope": "development backup and disposable rehearsal only",
                    "from": PREDECESSOR, "rehearsed_to": TARGET, "database": BINDING,
                    "backup": backup_evidence, "independent_restoration": True,
                    "complete_schema_match": True, "all_original_table_contents_match": True,
                    "tables_checked": len(original), "rows_checked": sum(v["rows"] for v in original.values()),
                    "rehearsal_seed": [1, 1, None], "rehearsal_readiness": "ready",
                    "source_revision_after": PREDECESSOR, "source_migrations_applied": 0,
                    "key_recovery": "Not independently re-attested by this run; existing keys unchanged",
                    "activation": "not performed; separate operator prerequisites remain",
                    "source_sha256": {str(p.relative_to(ROOT)): sha for p, sha in frozen.items()},
                }
                evidence = recovery / "recovery.json"
                evidence.write_text(json.dumps(report, indent=2) + "\n")
                storage.retain(evidence, recovery.name)
                print(json.dumps({k: report[k] for k in (
                    "independent_restoration", "complete_schema_match", "all_original_table_contents_match",
                    "tables_checked", "rows_checked", "rehearsal_readiness", "source_revision_after",
                    "source_migrations_applied", "activation")}), flush=True)
        return 0
    finally:
        engine.dispose()
        if started:
            run(["pg_ctl", "-D", str(recovery / "restored-cluster"), "-m", "fast", "-w", "stop"])
        log.close()
        storage.client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Tool output and recovery data stay in private local files. No exception
        # strings, connection arguments, rows, keys or storage credentials emitted.
        print("BATCH_RECOVERY_BLOCKED: " + type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)
