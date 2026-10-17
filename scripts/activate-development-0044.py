#!/usr/bin/env python3
"""Explicit original-development 0040 -> 0044 recovery and activation, never startup."""
import argparse
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"
sys.path.insert(0, str(BACKEND))
PREDECESSOR = "0040_po_tax_basis"
TARGET = "0044_purchase_received"
PENDING = ["0041_location_geography", "0042_rate_hundredths",
           "0043_email_templates", TARGET]
WORKSPACE = "9bd1d1ea-b7fe-4e8b-8aa6-02e5591a96a0"
NEW_TABLES = ("email_templates", "purchase_receipts", "purchase_receipt_sources",
              "purchase_receipt_history", "purchase_receipt_requests")
SEED_ID = "e7e80000-0000-4000-8000-000000000001"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def check_approval(args, settings):
    require(args.approve_0040_to_0044 and args.attest_key_recovery and args.writers_stopped,
            "Exact path approval, independently checked keys and stopped writers required")
    require(settings.app_env == "development" and os.environ.get("REPL_ID") == WORKSPACE,
            "Only the independently identified original development workspace is authorized")


def schema_digest(path):
    """Ignore dump wrapper randomness/version comments, never SQL definitions."""
    lines = []
    for line in path.read_text().splitlines():
        if line.startswith("--") or line.startswith("\\restrict ") or line.startswith("\\unrestrict "):
            continue
        if line.strip():
            lines.append(line)
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def verify_postgres_tools(server_version):
    """Do not mistake cross-major catalog rewriting for a faithful rehearsal."""
    major = server_version // 10000
    for tool in ("pg_dump", "pg_restore", "initdb", "pg_ctl", "createdb", "psql"):
        output = subprocess.check_output([tool, "--version"], text=True, timeout=10)
        match = re.search(r"\b(\d+)\.\d+", output)
        require(match and int(match[1]) == major,
                "Recovery tools must match the original PostgreSQL major version")


def data_inventory(connection, tables, *, expected=False):
    """Hash full rows; account only for the explicitly approved migration effects."""
    from psycopg import sql
    result = {}
    for schema, table in tables:
        if table == "alembic_version" and schema == "public":
            continue
        expression = "to_jsonb(t)"
        if schema == "public" and table == "storage_locations":
            expression += " - 'pincode' - 'country_code' - 'state' - 'city'"
        if schema == "public" and table in ("product_categories", "allergen_products"):
            expression += " - 'updated_at'"
            if expected:
                if table == "product_categories":
                    expression = f"({expression}) || jsonb_build_object('unit_price',round(unit_price,2),'version',version+1)"
                else:
                    expression = f"({expression}) || jsonb_build_object('selling_price',round(selling_price,2),'gst',round(gst,2),'version',version+1)"
        query = sql.SQL("SELECT ({})::text FROM {}.{} t ORDER BY 1").format(
            sql.SQL(expression), sql.Identifier(schema), sql.Identifier(table))
        digest, count = hashlib.sha256(), 0
        with connection.cursor(name="activation_inventory") as cursor:
            cursor.execute(query)
            for row in cursor:
                digest.update(row[0].encode() + b"\n")
                count += 1
        result[f"{schema}.{table}"] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def postconditions(connection, tables, expected, *, test_guards=False):
    require(data_inventory(connection, tables) == expected,
            "Existing data differs beyond the approved catalogue changes")
    require(connection.execute("SELECT version_num FROM public.alembic_version").fetchall()
            == [(TARGET,)], "Exact committed target required")
    seed = connection.execute(
        "SELECT id::text,event_key,version,provenance,name,description,subject,html,text "
        "FROM email_templates").fetchall()
    frozen = module("activation_template_seed", BACKEND / "alembic/versions/0043_email_templates.py").SEED
    require(seed == [(SEED_ID, "password_recovery", 1, "migration_seed",
                      *(frozen[k] for k in ("name", "description", "subject", "html", "text")))],
            "Required recovery seed differs")
    for table in NEW_TABLES[1:]:
        require(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0,
                "New receipt tables must remain empty")
    require(connection.execute("SELECT to_regclass('public.purchase_receipt_number_seq')").fetchone()[0],
            "Receipt sequence missing")
    require(connection.execute(
        "SELECT count(*) FROM storage_locations WHERE pincode<>'' OR country_code<>'' OR state<>'' OR city<>''"
    ).fetchone()[0] == 0, "Geography must not be inferred or backfilled")
    triggers = connection.execute(
        "SELECT tgname FROM pg_trigger WHERE tgrelid='email_templates'::regclass AND NOT tgisinternal"
    ).fetchall()
    require(set(triggers) == {("protect_recovery_email_delete",), ("protect_email_identity_update",),
                              ("protect_recovery_email_truncate",)}, "Recovery protection triggers differ")
    if test_guards:
        # Only on the disposable restoration, never mutate live records as a test.
        for statement in ("DELETE FROM email_templates",
                          "UPDATE email_templates SET event_key=NULL",
                          "TRUNCATE email_templates"):
            connection.execute("SAVEPOINT verify_guard")
            try:
                connection.execute(statement)
            except Exception as exc:
                connection.execute("ROLLBACK TO SAVEPOINT verify_guard")
                require(getattr(exc, "sqlstate", None) == "P0001",
                        "Guard check failed for an unexpected database reason")
            else:
                raise RuntimeError("Required recovery protection did not reject mutation")
            finally:
                connection.execute("RELEASE SAVEPOINT verify_guard")


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

    sync = module("activation_development_sync", ROOT / "scripts/development-sync.py")
    recovery_helpers = module("activation_recovery_helpers", ROOT / "scripts/activate-purchase-orders-development.py")
    settings = get_settings()
    check_approval(args, settings)
    ReceiptCrypto(settings)
    runner, graph, policy, target, _ = sync.source_review(ROOT)
    require(target == TARGET, "Reviewed application target changed")
    plan = runner.plan(graph, policy, [PREDECESSOR], TARGET)
    require(plan["pending"] == PENDING and plan["operator_only"] == PENDING,
            "Approved pending path or policy changed")
    binding = json.loads((ROOT / "scripts/development-database.json").read_text())
    require(binding == {"version": 1, "host": "helium", "port": 5432, "database": "heliumdb",
                        "cluster": "7689828272860483604", "oid": 16384}, "Approved binding changed")
    source_hash = hashlib.sha256((ROOT / "scripts/development-schema-review.json").read_bytes()).hexdigest()
    engine = create_engine(settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1),
                           hide_parameters=True)
    storage = recovery_helpers.PrivateRecovery(scope="development-0044")
    os.umask(0o077)
    recovery = Path(tempfile.mkdtemp(prefix="evexia-development-0044-", dir="/tmp"))
    print(f"RECOVERY_DIRECTORY: {recovery}", flush=True)
    log = (recovery / "tools.log").open("wb")
    started = False
    committed = False

    def run(command, env=None):
        subprocess.run(command, env=env, stdout=log, stderr=log, check=True, timeout=300)

    def verify_source():
        sync.source_review(ROOT)
        require(hashlib.sha256((ROOT / "scripts/development-schema-review.json").read_bytes()).hexdigest()
                == source_hash, "Reviewed source changed while preparing recovery")

    try:
        with engine.connect() as connection:
            with connection.begin():
                connection.exec_driver_sql("SET LOCAL lock_timeout='10s'")
                connection.exec_driver_sql("SET LOCAL statement_timeout='120s'")
                sync.target_matches(settings, connection, binding)
                require(connection.exec_driver_sql("SELECT pg_try_advisory_xact_lock(145002)").scalar_one(),
                        "Another operator is active")
                raw = connection.connection.driver_connection
                verify_postgres_tools(int(raw.execute("SHOW server_version_num").fetchone()[0]))
                require(raw.execute("SELECT version_num FROM alembic_version").fetchall()
                        == [(PREDECESSOR,)], "Exact 0040 predecessor required; no blind replay")
                require(not raw.execute("SELECT 1 FROM pg_class WHERE relname=ANY(%s)",
                                        (list(NEW_TABLES) + ["purchase_receipt_number_seq"],)).fetchall(),
                        "Partial successor objects require independent review")
                tables = raw.execute(
                    "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN "
                    "('pg_catalog','information_schema') ORDER BY 1,2").fetchall()
                raw.execute(sql.SQL("LOCK TABLE {} IN SHARE MODE").format(
                    sql.SQL(",").join(sql.Identifier(*row) for row in tables)))
                sync.target_matches(settings, connection, binding)
                require(raw.execute("SELECT count(*) FROM pg_largeobject_metadata").fetchone()[0] == 0,
                        "Large-object recovery needs separately reviewed inventory")
                snapshot = raw.execute("SELECT pg_export_snapshot()").fetchone()[0]
                original = recovery_helpers.inventory(raw)
                expected = data_inventory(raw, tables, expected=True)
                env = dict(os.environ, PGHOST=raw.info.host, PGPORT=str(raw.info.port),
                           PGDATABASE=raw.info.dbname, PGUSER=raw.info.user)
                if raw.info.password:
                    env["PGPASSWORD"] = raw.info.password
                backup = recovery / "before-0044.dump"
                run(["pg_dump", "--format=custom", "--snapshot", snapshot, "--file", str(backup)], env)
                run(["pg_restore", "--list", str(backup)])
                original_schema = recovery / "original-schema.sql"
                run(["pg_restore", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(original_schema), str(backup)])
                backup_evidence = storage.retain(backup, recovery.name)
                print("PRIVATE_BACKUP_VERIFIED: authenticated readback; anonymous access denied", flush=True)
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
                # Even same-major PostgreSQL reparses CHECK expressions on restore.
                # Independently load the complete original schema SQL, with no data,
                # into a second disposable database. Compare PostgreSQL's canonical
                # output byte-for-byte; do not strip casts/constraints or edit either
                # catalog to manufacture agreement.
                schema_env = dict(restore_env, PGDATABASE="schema_reference")
                run(["createdb"], schema_env)
                run(["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
                     "--file", str(original_schema)], schema_env)
                canonical_schema = recovery / "canonical-original-schema.sql"
                run(["pg_dump", "--schema-only", "--no-owner", "--no-acl",
                     "--file", str(canonical_schema)], schema_env)
                require(schema_digest(canonical_schema) == schema_digest(restored_schema),
                        "Restored schema differs; no original migrations applied")
                restored_engine = create_engine(URL.create(
                    "postgresql+psycopg", username=getpass.getuser(), database="development_recovery",
                    query={"host": str(socket), "port": "55432"}), hide_parameters=True)
                try:
                    with restored_engine.begin() as restored:
                        restored_raw = restored.connection.driver_connection
                        require(restored_raw.execute(
                            "SELECT system_identifier::text FROM pg_control_system()").fetchone()[0]
                            != binding["cluster"], "Restoration cluster is not independent")
                        require(recovery_helpers.inventory(restored_raw) == original,
                                "Full restored table contents differ")
                        require(restored_raw.execute("SELECT version_num FROM alembic_version").fetchall()
                                == [(PREDECESSOR,)], "Restored predecessor differs")
                        restored.exec_driver_sql("SELECT pg_advisory_xact_lock(145002)")
                        restored.exec_driver_sql("SET LOCAL lock_timeout='10s'")
                        restored.exec_driver_sql("SET LOCAL statement_timeout='120s'")
                        verify_source()
                        upgrade(restored)
                        postconditions(restored_raw, tables, expected, test_guards=True)
                finally:
                    restored_engine.dispose()
                report = {
                    "scope": "original development only", "from": PREDECESSOR, "to": TARGET,
                    "database": binding, "source_review_sha256": source_hash,
                    "backup": backup_evidence, "independent_restoration": True,
                    "complete_schema_match": True, "all_original_table_contents_match": True,
                    "schema_comparison": "Full source SQL independently round-tripped by same-major PostgreSQL; all definitions compared",
                    "tables_checked": len(original), "rows_checked": sum(v["rows"] for v in original.values()),
                    "exact_path_rehearsal": "passed", "historical_data_preserved": True,
                    "key_recovery": "Separate private recovery copies explicitly confirmed by operator",
                    "status": "rehearsal_complete_not_yet_activated",
                }
                evidence = recovery / "recovery.json"
                evidence.write_text(json.dumps(report, indent=2) + "\n")
                storage.retain(evidence, recovery.name)
                print("RESTORATION_AND_REHEARSAL_PASSED: complete schema/data; guards; readiness", flush=True)
                verify_source()
                sync.target_matches(settings, connection, binding)
                require(raw.execute("SELECT version_num FROM alembic_version").fetchall()
                        == [(PREDECESSOR,)], "Predecessor changed")
                upgrade(connection)
                postconditions(raw, tables, expected)
            committed = True
            with connection.begin():
                sync.target_matches(settings, connection, binding)
                require(connection.exec_driver_sql("SELECT version_num FROM alembic_version").all()
                        == [(TARGET,)], "Committed revision unverified; do not replay")
        report["status"] = "activation_committed"
        evidence = recovery / "activation.json"
        evidence.write_text(json.dumps(report, indent=2) + "\n")
        storage.retain(evidence, recovery.name)
        print(json.dumps(report), flush=True)
        return 0
    except Exception:
        print("ACTIVATION_NOT_CONFIRMED: inspect the private recovery directory. "
              "Precommit failures roll back; commit/output uncertainty requires read-only "
              "reconciliation, never automatic replay or downgrade.", file=sys.stderr)
        print(f"COMMIT_ACKNOWLEDGED: {committed}", file=sys.stderr)
        raise
    finally:
        engine.dispose()
        if started:
            run(["pg_ctl", "-D", str(recovery / "restored-cluster"), "-m", "fast", "-w", "stop"])
        log.close()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--approve-0040-to-0044", action="store_true", required=True)
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
