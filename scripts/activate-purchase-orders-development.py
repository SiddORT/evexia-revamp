#!/usr/bin/env python3
"""Explicit Replit DEVELOPMENT-only 0037 -> 0038 activation with private recovery.

No head upgrade, seed, bootstrap, production, or VPS execution. Supply independently
confirmed non-secret target identifiers; never derive confirmation from DATABASE_URL.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"
sys.path.insert(0, str(BACKEND))
PREDECESSOR = "0037_domain_admission"
TARGET = "0038_purchase_orders"
OBJECTS = (
    "purchase_orders", "purchase_order_lines", "purchase_order_audit",
    "purchase_order_requests", "purchase_order_number_seq",
)
MIGRATION_SHA = "768d4d86d2efc07fc78351091ec9ae5063a9cc7088bd0c787f93d5fc36b04c43"
ENV_SHA = "53ebac96cb7e80536bb993f17652dfc65a3e5c68b9efbcecc343571fd544e354"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_target(settings, args):
    require(settings.app_env == "development" and args.approve_development,
            "Explicit development-only approval required")
    require(args.confirm_database == "heliumdb", "Only confirmed Replit heliumdb is supported")
    require(args.confirm_host == "helium", "Only the confirmed Replit Helium host is supported")


def inventory(connection):
    """Compare full restored table contents without logging any records."""
    from psycopg import sql
    result = {}
    tables = connection.execute(
        "SELECT schemaname, tablename FROM pg_tables "
        "WHERE schemaname NOT IN ('pg_catalog','information_schema') "
        "ORDER BY schemaname, tablename"
    ).fetchall()
    for schema, table in tables:
        digest, count = hashlib.sha256(), 0
        with connection.cursor(name="recovery_inventory") as cursor:
            cursor.execute(sql.SQL(
                "SELECT row_to_json(t)::text FROM {}.{} t ORDER BY row_to_json(t)::text"
            ).format(sql.Identifier(schema), sql.Identifier(table)))
            for row in cursor:
                digest.update(row[0].encode() + b"\n")
                count += 1
        result[f"{schema}.{table}"] = {"rows": count, "sha256": digest.hexdigest()}
    return result


class PrivateRecovery:
    """Use existing Replit sidecar credentials; never print or persist credentials."""
    def __init__(self, scope="purchase-orders"):
        import httpx
        require(scope in ("purchase-orders", "development-0044"), "Unknown recovery scope")
        self.scope = scope
        self.client = httpx.Client(verify=ssl.create_default_context(), timeout=90)
        directory = os.environ.get("PRIVATE_OBJECT_DIR", "").strip("/")
        require("/" in directory, "Existing private App Storage is required")
        self.bucket, self.prefix = directory.split("/", 1)
        public = os.environ.get("PUBLIC_OBJECT_SEARCH_PATHS", "").split(",")
        require(not any(directory.startswith(p.strip().strip("/") + "/")
                        or directory == p.strip().strip("/")
                        for p in public if p.strip()), "Private recovery overlaps public storage")
        credential = self.client.get("http://127.0.0.1:1106/credential")
        credential.raise_for_status()
        token = self.client.post("http://127.0.0.1:1106/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "audience": "replit",
            "scope": "https://www.googleapis.com/auth/devstorage.full_control",
            "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
            "subject_token_type": "access_token",
            "subject_token": credential.json()["access_token"],
        })
        token.raise_for_status()
        self.headers = {"Authorization": "Bearer " + token.json()["access_token"]}

    def retain(self, path, run_id):
        name = f"{self.prefix}/operator-recovery/{self.scope}/{run_id}/{path.name}"
        url = f"https://storage.googleapis.com/storage/v1/b/{quote(self.bucket, safe='')}/o/{quote(name, safe='')}"
        upload = self.client.post(
            f"https://storage.googleapis.com/upload/storage/v1/b/{quote(self.bucket, safe='')}/o",
            params={"uploadType": "media", "name": name, "ifGenerationMatch": "0"},
            headers={**self.headers, "Content-Type": "application/octet-stream"},
            content=path.read_bytes(),
        )
        upload.raise_for_status()
        readback = self.client.get(url, params={"alt": "media"}, headers=self.headers)
        readback.raise_for_status()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        require(hashlib.sha256(readback.content).hexdigest() == digest, "Storage readback differs")
        anonymous = self.client.get(url, params={"alt": "media"})
        require(anonymous.status_code in (401, 403, 404), "Anonymous storage access was not denied")
        return {"object": name, "sha256": digest, "anonymous_access_denied": True}


def activate(args):
    import psycopg
    from psycopg import sql
    from sqlalchemy import create_engine
    from alembic import command
    from alembic.config import Config
    from app.core.config import get_settings

    settings = get_settings()
    validate_target(settings, args)
    url = settings.database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    source = BACKEND / "alembic/versions/0038_purchase_orders.py"
    require(hashlib.sha256(source.read_bytes()).hexdigest() == MIGRATION_SHA
            and hashlib.sha256((BACKEND / "alembic/env.py").read_bytes()).hexdigest() == ENV_SHA,
            "Reviewed migration or Alembic environment changed")
    engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1),
                           hide_parameters=True)
    storage = PrivateRecovery()
    os.umask(0o077)
    recovery = Path(tempfile.mkdtemp(prefix="evexia-po-recovery-", dir="/tmp"))
    print(f"Private local recovery directory: {recovery}", flush=True)
    log = (recovery / "tools.log").open("wb")

    def run(command_args, env=None):
        subprocess.run(command_args, env=env, stdout=log, stderr=log,
                       check=True, timeout=180)

    cluster_started = False
    try:
        # Match the existing operator deployment mutex, then exclude ordinary
        # writers with SHARE locks held until backup/rehearsal/DDL all finish.
        with engine.connect() as sa_connection:
            transaction = sa_connection.begin()
            connection = sa_connection.connection.driver_connection
            connection.execute("SET LOCAL lock_timeout = '10s'")
            require(connection.execute("SELECT pg_try_advisory_xact_lock(145002)").fetchone()[0],
                    "Another migration operator is active")
            identity = connection.execute(
                "SELECT current_database(), (SELECT system_identifier::text FROM pg_control_system()), "
                "(SELECT oid FROM pg_database WHERE datname=current_database())"
            ).fetchone()
            require(identity == (args.confirm_database, args.confirm_cluster, args.confirm_oid),
                    "Confirmed database/cluster identity differs")
            require(connection.info.host == args.confirm_host, "Confirmed connection host differs")
            require(connection.execute("SELECT version_num FROM alembic_version").fetchall()
                    == [(PREDECESSOR,)], "Exact predecessor required; no replay or unrelated upgrade")
            require(not connection.execute(
                "SELECT 1 FROM pg_class WHERE relname = ANY(%s)", (list(OBJECTS),)
            ).fetchall(), "Partial or pre-existing PO objects require operator review")
            tables = connection.execute(
                "SELECT schemaname, tablename FROM pg_tables "
                "WHERE schemaname NOT IN ('pg_catalog','information_schema') "
                "ORDER BY schemaname, tablename"
            ).fetchall()
            connection.execute(sql.SQL("LOCK TABLE {} IN SHARE MODE").format(
                sql.SQL(", ").join(sql.Identifier(*row) for row in tables)
            ))
            snapshot = connection.execute("SELECT pg_export_snapshot()").fetchone()[0]
            env = dict(os.environ, PGHOST=connection.info.host,
                       PGPORT=str(connection.info.port), PGUSER=connection.info.user,
                       PGDATABASE=connection.info.dbname)
            if connection.info.password:
                env["PGPASSWORD"] = connection.info.password
            backup = recovery / "before-0038.dump"
            run(["pg_dump", "--format=custom", "--snapshot", snapshot,
                 "--file", str(backup)], env)
            run(["pg_restore", "--list", str(backup)])
            original = inventory(connection)
            source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
            # Independently restored cluster: no TCP listener and private socket.
            socket = recovery / "socket"
            socket.mkdir(mode=0o700)
            data = recovery / "rehearsal"
            run(["initdb", "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8"])
            run(["pg_ctl", "-D", str(data), "-l", str(recovery / "postgres.log"),
                 "-o", f"-k {socket} -p 5432 -c listen_addresses=''", "start"])
            cluster_started = True
            restore_env = dict(os.environ, PGHOST=str(socket), PGPORT="5432",
                               PGUSER=getpass.getuser(),
                               PGDATABASE="po_recovery")
            restore_env.pop("PGPASSWORD", None)
            run(["createdb"], restore_env)
            run(["pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                 "--dbname", "po_recovery", str(backup)], restore_env)
            with psycopg.connect(host=str(socket), port=5432, dbname="po_recovery",
                                 user=restore_env["PGUSER"]) as restored:
                require(restored.execute("SELECT system_identifier::text FROM pg_control_system()").fetchone()[0]
                        != identity[1], "Restoration must use a distinct PostgreSQL cluster")
                require(original == inventory(restored), "Restored table contents differ")
                require(restored.execute("SELECT version_num FROM alembic_version").fetchall()
                        == [(PREDECESSOR,)], "Restored predecessor differs")
            report = {
                "scope": "Replit Helium development only", "database": identity[0],
                "cluster": identity[1], "database_oid": identity[2],
                "from": PREDECESSOR, "to": TARGET, "migration_sha256": source_sha,
                "restore_exit_on_error": True, "all_table_contents_match": True,
                "tables_checked": len(original), "rows_checked": sum(x["rows"] for x in original.values()),
                "key_custody": "Existing workspace secrets unchanged; independent key recovery not attested",
                "backup": storage.retain(backup, recovery.name),
            }
            evidence = recovery / "recovery.json"
            evidence.write_text(json.dumps(report, indent=2) + "\n")
            storage.retain(evidence, recovery.name)
            print("Backup retained privately; anonymous access denied; full restoration matches.", flush=True)
            # Execute only the reviewed successor on the SAME locked connection.
            require(hashlib.sha256(source.read_bytes()).hexdigest() == source_sha
                    and hashlib.sha256((BACKEND / "alembic/env.py").read_bytes()).hexdigest() == ENV_SHA,
                    "Migration source or environment changed during recovery")
            config = Config(str(BACKEND / "alembic.ini"))
            config.set_main_option("script_location", str(BACKEND / "alembic"))
            config.attributes["connection"] = sa_connection
            command.upgrade(config, TARGET)
            require(connection.execute("SELECT version_num FROM alembic_version").fetchall()
                    == [(TARGET,)], "Activation revision postcondition failed")
            for name in OBJECTS:
                require(connection.execute("SELECT to_regclass(%s)", ("public." + name,)).fetchone()[0],
                        "Activation object postcondition failed")
            for name in OBJECTS[:-1]:
                require(connection.execute(sql.SQL("SELECT count(*) FROM {}").format(
                    sql.Identifier(name))).fetchone()[0] == 0, "New PO tables must be empty")
            transaction.commit()
            report["activation"] = "committed"
            evidence = recovery / "activation.json"
            evidence.write_text(json.dumps(report, indent=2) + "\n")
            storage.retain(evidence, recovery.name)
            print(json.dumps(report, indent=2), flush=True)
    finally:
        if cluster_started:
            run(["pg_ctl", "-D", str(recovery / "rehearsal"), "-m", "fast", "stop"])
        log.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-database", required=True)
    parser.add_argument("--confirm-host", required=True)
    parser.add_argument("--confirm-cluster", required=True)
    parser.add_argument("--confirm-oid", required=True, type=int)
    parser.add_argument("--approve-development", action="store_true")
    arguments = parser.parse_args()
    try:
        activate(arguments)
    except Exception as error:
        # Tool output/tracebacks can contain connection details or restored data.
        print(f"Activation stopped ({type(error).__name__}). Check the private recovery log; "
              "inspect the database revision before retrying.", file=sys.stderr)
        sys.exit(1)
