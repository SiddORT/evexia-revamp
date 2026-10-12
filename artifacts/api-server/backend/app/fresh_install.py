"""Explicit production-only, staged operator initialization; never a CI fallback."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.schema import SCHEMA_REVISION
from app.services.directory_crypto import DirectoryCrypto
from app.services.staff_crypto import StaffCrypto

ROOT = Path(__file__).resolve().parents[4]
BACKEND = ROOT / "artifacts/api-server/backend"
LOCK_PATH = Path("/var/www/newuat.allergyevexia.in/.deploy.lock")
PREPARE_TARGET = "0031_role_hostnames"
FINAL_TARGET = "0034_shared_phone_countries"
LOCK_ID = 145002  # Same database interlock as normal CI/operator continuation.


class FreshInstallBlocked(Exception):
    """Only curated non-sensitive messages reach the operator."""


def verify_supervisor():
    marker = LOCK_PATH.parent / ".operator-maintenance"
    try:
        if os.environ.get("EVEXIA_DEPLOY_LOCK") != str(LOCK_PATH):
            raise ValueError()
        descriptor = int(os.environ["EVEXIA_DEPLOY_LOCK_FD"])
        if descriptor < 3:
            raise ValueError()
        for path in (LOCK_PATH, marker):
            if path != path.resolve(strict=True) or not stat.S_ISREG(path.stat().st_mode):
                raise ValueError()
        opened, expected = os.fstat(descriptor), LOCK_PATH.stat()
        if (opened.st_dev, opened.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError()
        records = Path(f"/proc/self/fdinfo/{descriptor}").read_text().splitlines()
        if not any(len(parts := line.split()) >= 5 and parts[0] == "lock:"
                   and parts[2:5] == ["FLOCK", "ADVISORY", "WRITE"] for line in records):
            raise ValueError()
    except Exception:
        raise FreshInstallBlocked("Canonical maintenance marker and inherited exclusive CI flock required.") from None


def reviewed_graph(root=ROOT):
    """Fail closed on ANY changed/unreviewed migration or policy, by revision ID."""
    review = json.loads((root / "scripts/fresh-install-review.json").read_text())
    hashes = {}
    for path in (root / "artifacts/api-server/backend/alembic/versions").glob("*.py"):
        assignments = [node for node in ast.parse(path.read_text()).body
                       if isinstance(node, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == "revision" for t in node.targets)]
        if len(assignments) != 1:
            raise FreshInstallBlocked("Migration review is incomplete.")
        revision = ast.literal_eval(assignments[0].value)
        if not isinstance(revision, str) or revision in hashes:
            raise FreshInstallBlocked("Migration review is ambiguous.")
        hashes[revision] = hashlib.sha256(path.read_bytes()).hexdigest()
    if (hashes != review["revisions"]
            or hashlib.sha256((root / "scripts/migration-policy.json").read_bytes()).hexdigest() != review["policy_sha256"]
            or review["prepare_target"] != PREPARE_TARGET
            or review["target"] != FINAL_TARGET or SCHEMA_REVISION != FINAL_TARGET):
        raise FreshInstallBlocked("Migration/policy/application release changed; fresh-install review required.")
    if any(hashlib.sha256((root / "artifacts/api-server/backend" / path).read_bytes()).hexdigest() != digest
           for path, digest in review["guard_sources"].items()):
        raise FreshInstallBlocked("Migration guard changed; fresh-install review required.")
    spec = importlib.util.spec_from_file_location("fresh_install_policy", root / "scripts/deploy-migrations.py")
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    graph = runner.load_graph(root / "artifacts/api-server/backend/alembic/versions")
    policy = runner.load_policy(root / "scripts/migration-policy.json")
    if set(graph) != set(policy):
        raise FreshInstallBlocked("Every migration must be classified.")
    # Validate SOURCE only, without supplying an assumed database revision.
    heads = set(graph) - {parent for node in graph.values() for parent in node.down_revision}
    if heads != {FINAL_TARGET} or set(runner.ordered_ancestors(graph, FINAL_TARGET)) != set(graph):
        raise FreshInstallBlocked("Unexpected source heads/dependencies.")
    if "0031_remove_organizations" in runner.ordered_ancestors(graph, PREPARE_TARGET):
        raise FreshInstallBlocked("Preparation must never reach organization retirement.")
    return graph


def configuration(settings):
    if settings.app_env != "production" or os.environ.get("APP_ENV") != "production":
        raise FreshInstallBlocked("APP_ENV=production is required.")
    StaffCrypto(settings)
    DirectoryCrypto(settings)
    password = settings.super_admin_initial_password
    if password is None or not 12 <= len(password.get_secret_value()) <= 128:
        raise FreshInstallBlocked("A valid SUPER_ADMIN_INITIAL_PASSWORD is required before initialization.")


def dedicated_database(connection):
    if connection.scalar(text("SELECT current_schema()")) != "public":
        raise FreshInstallBlocked("A dedicated pristine public-schema database is required.")
    if connection.scalar(text("""
        SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_'
          AND nspname NOT IN ('public','information_schema'))
        OR EXISTS(SELECT 1 FROM pg_extension WHERE extname NOT IN ('plpgsql','pg_trgm'))
        OR EXISTS(SELECT 1 FROM pg_largeobject_metadata)
        OR EXISTS(SELECT 1 FROM pg_foreign_server)
        OR EXISTS(SELECT 1 FROM pg_event_trigger)
    """)):
        raise FreshInstallBlocked("Database contains unreviewed objects; use the existing operator workflow.")


def pristine(connection):
    """Reject a version table (even empty), other schemas, or any user objects."""
    dedicated_database(connection)
    if connection.scalar(text("""
        SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='public')
    """)):
        raise FreshInstallBlocked("Database is not pristine; zero migrations applied.")
    # Allow already-installed trusted pg_trgm objects, including internally
    # dependent array types. Everything else in public must be absent.
    if connection.scalar(text("""
        WITH RECURSIVE extension_objects(classid,objid) AS (
          SELECT classid,objid FROM pg_depend
            WHERE refclassid='pg_extension'::regclass AND deptype='e'
          UNION
          SELECT d.classid,d.objid FROM pg_depend d JOIN extension_objects e
            ON d.refclassid=e.classid AND d.refobjid=e.objid WHERE d.deptype IN ('i','a')
        ), objects(classid,objid,namespace) AS (
          SELECT 'pg_class'::regclass,oid,relnamespace FROM pg_class
          UNION ALL SELECT 'pg_proc'::regclass,oid,pronamespace FROM pg_proc
          UNION ALL SELECT 'pg_type'::regclass,oid,typnamespace FROM pg_type
          UNION ALL SELECT 'pg_operator'::regclass,oid,oprnamespace FROM pg_operator
          UNION ALL SELECT 'pg_collation'::regclass,oid,collnamespace FROM pg_collation
          UNION ALL SELECT 'pg_conversion'::regclass,oid,connamespace FROM pg_conversion
        )
        SELECT EXISTS(SELECT 1 FROM objects o JOIN pg_namespace n ON n.oid=o.namespace
          WHERE n.nspname='public' AND NOT EXISTS(
            SELECT 1 FROM extension_objects e WHERE e.classid=o.classid AND e.objid=o.objid))
    """)):
        raise FreshInstallBlocked("Database is not pristine; zero migrations applied.")


def alembic_config(connection):
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.attributes["connection"] = connection
    return config


def prepare(connection):
    """Caller owns transaction/lock: proof and all historical DDL are atomic."""
    pristine(connection)
    command.upgrade(alembic_config(connection), PREPARE_TARGET)
    if connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != [PREPARE_TARGET]:
        raise FreshInstallBlocked("Unexpected preparation revision; transaction rolled back.")


def finalize(connection, settings, hostname=None):
    """Only a never-used CURRENT schema can be bootstrapped by this command."""
    from app.db.base import Base
    from app.db import models  # noqa: F401
    from app.bootstrap import bootstrap_super_admin
    from app.api.v1.system import readiness
    dedicated_database(connection)
    if connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != [FINAL_TARGET]:
        raise FreshInstallBlocked("Complete the existing protected operator continuation first.")
    expected = set(Base.metadata.tables) | {"alembic_version", "directory_crypto_stage"}
    if set(inspect(connection).get_table_names(schema="public")) != expected:
        raise FreshInstallBlocked("Unexpected installation tables; operator review required.")
    if connection.scalar(text("""
        SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('v','m','f'))
    """)):
        raise FreshInstallBlocked("Unexpected installation views/foreign tables; operator review required.")
    quote = connection.dialect.identifier_preparer.quote
    tables = sorted(expected - {"alembic_version", "directory_crypto_stage"})
    connection.execute(text("LOCK TABLE " + ", ".join('public.' + quote(t) for t in sorted(expected)) +
                            " IN ACCESS EXCLUSIVE MODE NOWAIT"))
    for table in tables:
        if connection.scalar(text(f"SELECT EXISTS(SELECT 1 FROM public.{quote(table)})")):
            raise FreshInstallBlocked("Installation already contains records; no accounts or credentials changed.")
    with Session(bind=connection) as db:
        result = bootstrap_super_admin(db, settings.super_admin_initial_password)
        if hostname is not None:
            from app.db.models import AuditEvent
            from app.db.role_url_models import RoleHostname
            row = RoleHostname(hostname=hostname, role="admin", enabled=True,
                               created_by=result.user_id, updated_by=result.user_id)
            db.add(row)
            db.flush()
            db.add(AuditEvent(actor_id=result.user_id, action="fresh_install_hostname",
                              resource_type="role_url", resource_id=row.id, outcome="success"))
            db.flush()
        # Uses the unchanged application readiness requirement/crypto checks.
        readiness(db)
    # bootstrap's Session.commit cannot commit this caller-owned transaction.
    # A subsequent error rolls back bootstrap AND optional hostname together.


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "finalize"))
    parser.add_argument("--approve-fresh-install", action="store_true",
                        help="Approve reviewed history only through 0031_role_hostnames on a proven pristine DB.")
    parser.add_argument("--approve-bootstrap", action="store_true")
    parser.add_argument("--writers-stopped", action="store_true")
    parser.add_argument("--admin-hostname", help="Explicit optional initial Admin hostname; never inferred.")
    args = parser.parse_args(argv)
    try:
        if not args.writers_stopped or (
            args.phase == "prepare" and (not args.approve_fresh_install or args.approve_bootstrap or args.admin_hostname)
        ) or (args.phase == "finalize" and (not args.approve_bootstrap or args.approve_fresh_install)):
            raise FreshInstallBlocked("Separate phase-specific approval and stopped-writer attestation required.")
        hostname = None
        if args.admin_hostname is not None:
            from app.schemas.role_urls import canonical_hostname
            hostname = canonical_hostname(args.admin_hostname)
        verify_supervisor()
        reviewed_graph()
        settings = get_settings()
        configuration(settings)
        url = settings.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        if not url.startswith("postgresql+psycopg://"):
            raise FreshInstallBlocked("PostgreSQL is required.")
        engine = create_engine(url, hide_parameters=True)
        try:
            with engine.begin() as connection:
                connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                if args.phase == "prepare":
                    prepare(connection)
                else:
                    finalize(connection, settings, hostname)
        finally:
            engine.dispose()
        print("FRESH_INSTALL_PREPARED: 0031_role_hostnames; protected recovery/retirement required; NOT READY."
              if args.phase == "prepare" else "FRESH_INSTALL_READY: 0034_shared_phone_countries; Super Admin initialized.")
        return 0
    except FreshInstallBlocked as exc:
        print(f"FRESH_INSTALL_BLOCKED: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("FRESH_INSTALL_FAILED: retain maintenance; verify actual revision/account state before retry. "
              "No connection strings or recovery contents are printed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
