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
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.schema import SCHEMA_REVISION
from app.services.directory_crypto import DirectoryCrypto
from app.services.staff_crypto import StaffCrypto

ROOT = Path(__file__).resolve().parents[4]
BACKEND = ROOT / "artifacts/api-server/backend"
LOCK_PATH = Path("/var/www/admin-uat.allergyevexia.in/.deploy.lock")
PREPARE_TARGET = "0031_role_hostnames"
FINAL_TARGET = SCHEMA_REVISION
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
    if review.get("status") != "reviewed_candidate_requires_release_policy":
        raise FreshInstallBlocked("Explicit policy-reviewed candidate boundary required.")
    from app.services import release_authorization as authorization
    authorization.policy(root)
    if review.get("authorization_policy_sha256") != authorization.sha(
            root / "scripts/release-authorization-policy.json"):
        raise FreshInstallBlocked("Release authorization policy changed; review required.")
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
    if any(hashlib.sha256((root / path).read_bytes()).hexdigest() != digest
           for path, digest in review["release_sources"].items()):
        raise FreshInstallBlocked("Release tooling changed; fresh-install review required.")
    spec = importlib.util.spec_from_file_location("fresh_install_policy", root / "scripts/deploy-migrations.py")
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    graph = runner.load_graph(root / "artifacts/api-server/backend/alembic/versions")
    policy = runner.load_policy(root / "scripts/migration-policy.json")
    try:
        runner.validate_classifications(graph, policy)
    except runner.PolicyError:
        raise FreshInstallBlocked("Invalid migration policy or unknown classification.") from None
    # Validate SOURCE only, without supplying an assumed database revision.
    heads = set(graph) - {parent for node in graph.values() for parent in node.down_revision}
    if heads != {FINAL_TARGET} or set(runner.ordered_ancestors(graph, FINAL_TARGET)) != set(graph):
        raise FreshInstallBlocked("Unexpected source heads/dependencies.")
    if "0031_remove_organizations" in runner.ordered_ancestors(graph, PREPARE_TARGET):
        raise FreshInstallBlocked("Preparation must never reach organization retirement.")
    return graph


def approve_release(digest):
    """An explicit human attestation of the exact candidate, not automatic approval."""
    actual = hashlib.sha256((ROOT / "scripts/fresh-install-review.json").read_bytes()).hexdigest()
    if digest != actual:
        raise FreshInstallBlocked("Human release approval must name the exact reviewed manifest SHA256.")


def catalog(connection, revision):
    from app.services.fresh_catalog import digest
    expectations = json.loads((ROOT / "scripts/fresh-install-catalog.json").read_text())
    expected = expectations.get(revision)
    if expected is None:
        raise FreshInstallBlocked("Unexpected installation catalog; operator review required.")
    base, additions, visited = expected, {}, set()
    while True:
        if id(base) in visited:
            raise FreshInstallBlocked("Cyclic catalog review.")
        visited.add(id(base))
        for section, rows in base.get("additions", {}).items():
            additions.setdefault(section, []).extend(rows)
        if "base_revision" not in base:
            break
        base = expectations[base["base_revision"]]
    try:
        actual = digest(connection, additions=additions)
    except ValueError:
        raise FreshInstallBlocked("Unexpected installation catalog; operator review required.") from None
    if actual != base["sha256"]:
        raise FreshInstallBlocked("Unexpected installation catalog; operator review required.")
    if "purchase_orders" in expected["tables"]:
        if connection.execute(text(
                "SELECT last_value,is_called FROM purchase_order_number_seq")).one() != (1, False):
            raise FreshInstallBlocked("Purchase Order sequence is not unused; operator review required.")
    if "purchase_receipts" in expected["tables"]:
        if connection.execute(text(
                "SELECT last_value,is_called FROM purchase_receipt_number_seq")).one() != (1, False):
            raise FreshInstallBlocked("Purchase Receipt sequence is not unused; operator review required.")
    return set(expected["tables"])


def configuration(settings):
    if settings.app_env != "production" or os.environ.get("APP_ENV") != "production":
        raise FreshInstallBlocked("APP_ENV=production is required.")
    StaffCrypto(settings)
    DirectoryCrypto(settings)
    from app.services.communication_crypto import CommunicationCrypto
    CommunicationCrypto(settings)
    # Receipt/inventory readiness requires its independent keyring too. Reject
    # missing/reused material before running any DDL, rather than discovering
    # it through the intentionally opaque public readiness HTTP 503 at the end.
    from app.services.purchase_received_crypto import ReceiptCrypto, PRError
    try:
        ReceiptCrypto(settings)
    except PRError:
        raise FreshInstallBlocked(
            "Valid independent PR encryption configuration is required before initialization."
        ) from None
    password = settings.super_admin_initial_password
    if password is None or not 12 <= len(password.get_secret_value()) <= 128:
        raise FreshInstallBlocked("A valid SUPER_ADMIN_INITIAL_PASSWORD is required before initialization.")


def verify_database_target(connection, expected_database, expected_system_identifier):
    """Bind approval to the reviewed database AND cluster, not a URL string."""
    actual = connection.execute(text("""
        SELECT current_database(), system_identifier
        FROM pg_catalog.pg_control_system()
    """)).one()
    if actual[0] != expected_database or actual[1] != expected_system_identifier:
        raise FreshInstallBlocked("Database/cluster identity does not match the independently approved target; zero changes applied.")


def dedicated_database(connection):
    if connection.scalar(text("SELECT current_schema()")) != "public":
        raise FreshInstallBlocked("A dedicated pristine public-schema database is required.")
    if connection.scalar(text("""
        SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_'
          AND nspname NOT IN ('public','information_schema'))
        OR EXISTS(SELECT 1 FROM pg_extension WHERE extname NOT IN ('plpgsql','pg_trgm'))
        OR EXISTS(SELECT 1 FROM pg_largeobject_metadata)
        OR EXISTS(SELECT 1 FROM pg_foreign_server)
        OR EXISTS(SELECT 1 FROM pg_foreign_data_wrapper)
        OR EXISTS(SELECT 1 FROM pg_event_trigger)
        OR EXISTS(SELECT 1 FROM pg_default_acl)
        OR EXISTS(SELECT 1 FROM pg_publication)
        OR EXISTS(SELECT 1 FROM pg_subscription
                  WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database()))
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
          UNION ALL SELECT 'pg_opclass'::regclass,oid,opcnamespace FROM pg_opclass
          UNION ALL SELECT 'pg_opfamily'::regclass,oid,opfnamespace FROM pg_opfamily
          UNION ALL SELECT 'pg_ts_config'::regclass,oid,cfgnamespace FROM pg_ts_config
          UNION ALL SELECT 'pg_ts_dict'::regclass,oid,dictnamespace FROM pg_ts_dict
          UNION ALL SELECT 'pg_ts_parser'::regclass,oid,prsnamespace FROM pg_ts_parser
          UNION ALL SELECT 'pg_ts_template'::regclass,oid,tmplnamespace FROM pg_ts_template
        )
        SELECT EXISTS(SELECT 1 FROM objects o JOIN pg_namespace n ON n.oid=o.namespace
          WHERE (n.nspname='public'
            OR (n.nspname IN ('pg_catalog','pg_toast') AND o.objid>=16384)
            OR n.nspname ~ '^pg_(toast_)?temp_') AND NOT EXISTS(
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
    from app.bootstrap import bootstrap_super_admin
    from app.api.v1.system import readiness
    dedicated_database(connection)
    revisions = connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    # Only explicitly catalog-reviewed descendants of the unchanged retirement
    # cap qualify. New releases do not require another handwritten target list.
    graph = reviewed_graph()
    def after_retirement(revision):
        return revision == "0034_shared_phone_countries" or any(
            after_retirement(parent) for parent in graph[revision].parents)
    stages = json.loads((ROOT / "scripts/fresh-install-catalog.json").read_text())
    predecessors = tuple([r] for r in stages if r != FINAL_TARGET and r in graph and after_retirement(r))
    if revisions not in (*predecessors, [FINAL_TARGET]):
        raise FreshInstallBlocked("Complete the existing protected operator continuation first.")
    expected = catalog(connection, revisions[0])
    quote = connection.dialect.identifier_preparer.quote
    tables = sorted(expected - {"alembic_version", "directory_crypto_stage", "account_crypto_state"})
    connection.execute(text("LOCK TABLE " + ", ".join('public.' + quote(t) for t in sorted(expected)) +
                            " IN ACCESS EXCLUSIVE MODE NOWAIT"))
    catalog(connection, revisions[0])
    migration_owned = migration_owned_tables(connection, expected)
    for table in tables:
        if table in migration_owned:
            continue  # Only exact migration-owned constants verified under locks.
        if connection.scalar(text(f"SELECT EXISTS(SELECT 1 FROM public.{quote(table)})")):
            raise FreshInstallBlocked("Installation already contains records; no accounts or credentials changed.")
    if revisions in predecessors:
        # Explicit fresh-finalize approval already binds the independently
        # verified target and proves ALL business tables empty under locks.
        # This is not permission to migrate a populated account database.
        command.upgrade(alembic_config(connection), FINAL_TARGET)
    if connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != [FINAL_TARGET]:
        raise FreshInstallBlocked("Unexpected final revision; transaction rolled back.")
    catalog(connection, FINAL_TARGET)
    migration_owned_tables(connection, expected | set(stages[FINAL_TARGET]["tables"]))
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


def communication_channels(connection):
    """Seeded channel versions are migration metadata, not disposable user data."""
    if connection.execute(text(
            "SELECT channel, version FROM communication_channels ORDER BY channel"
    )).all() != [("email", 1), ("sms", 1), ("waba", 1)]:
        raise FreshInstallBlocked("Communication channel state is not pristine; operator review required.")


def migration_owned_tables(connection, tables):
    """Verify every seed field and row count; never exempt arbitrary table data."""
    verified = set()
    if "communication_channels" in tables:
        communication_channels(connection)
        verified.add("communication_channels")
    if "email_templates" in tables:
        # The original migration source is hash-bound by reviewed_graph().
        # Use its frozen seed, never the mutable runtime template or ORM defaults.
        from alembic.script import ScriptDirectory
        script = ScriptDirectory.from_config(alembic_config(connection))
        seed = script.get_revision("0043_email_templates").module.SEED
        rows = [dict(row) for row in connection.execute(text("""
            SELECT id::text AS id, name, description, subject, html, text,
                   version, event_key, provenance, created_by, updated_by,
                   created_at = updated_at AS timestamps_unchanged
            FROM email_templates LIMIT 2
        """)).mappings()]
        if rows != [{**seed, "version": 1, "event_key": "password_recovery",
                     "provenance": "migration_seed", "created_by": None,
                     "updated_by": None, "timestamps_unchanged": True}]:
            raise FreshInstallBlocked("Recovery email template is not pristine; operator review required.")
        verified.add("email_templates")
    if "pr_batch_settings" in tables:
        if connection.execute(text(
                "SELECT id, version, payload_ciphertext FROM pr_batch_settings"
        )).all() != [(1, 1, None)]:
            raise FreshInstallBlocked("Batch settings are not pristine; operator review required.")
        verified.add("pr_batch_settings")
    return verified


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "finalize"))
    parser.add_argument("--approve-fresh-install", action="store_true",
                        help="Approve reviewed history only through 0031_role_hostnames on a proven pristine DB.")
    parser.add_argument("--approve-bootstrap", action="store_true",
                        help=f"Approve empty-only finalization through {FINAL_TARGET} and atomic protected bootstrap.")
    parser.add_argument("--writers-stopped", action="store_true")
    approval = parser.add_mutually_exclusive_group(required=True)
    approval.add_argument("--approve-release",
                          help="Existing explicit operator release approval: manifest SHA256.")
    approval.add_argument("--validated-release",
                          help="Signed successful machine validation; fresh-only authorization.")
    parser.add_argument("--trust-config")
    parser.add_argument("--recovery-evidence")
    parser.add_argument("--fresh-state")
    parser.add_argument("--admin-hostname", help="Explicit optional initial Admin hostname; never inferred.")
    parser.add_argument("--expected-database", required=True,
                        help="Database name from independently verified target evidence, not inferred from DATABASE_URL.")
    parser.add_argument("--expected-system-identifier", required=True, type=int,
                        help="PostgreSQL cluster system identifier from independently verified target evidence.")
    args = parser.parse_args(argv)
    try:
        if not args.expected_database or not 0 < args.expected_system_identifier < 2**64:
            raise FreshInstallBlocked("Explicit valid approved database/cluster identity required.")
        automatic = args.validated_release is not None
        if automatic and (
            not all((args.trust_config, args.recovery_evidence, args.fresh_state))
            or args.approve_fresh_install or args.approve_bootstrap
        ):
            raise FreshInstallBlocked("Complete independent automatic evidence required; do not mix approval modes.")
        if not automatic and any((args.trust_config, args.recovery_evidence, args.fresh_state)):
            raise FreshInstallBlocked("Do not mix operator and machine approval modes.")
        if not args.writers_stopped or (not automatic and ((
            args.phase == "prepare" and (not args.approve_fresh_install or args.approve_bootstrap or args.admin_hostname)
        ) or (args.phase == "finalize" and (not args.approve_bootstrap or args.approve_fresh_install)))):
            raise FreshInstallBlocked("Separate phase-specific approval and stopped-writer attestation required.")
        hostname = None
        if args.admin_hostname is not None:
            from app.schemas.role_urls import canonical_hostname
            hostname = canonical_hostname(args.admin_hostname)
        verify_supervisor()
        reviewed_graph()
        if not automatic:
            approve_release(args.approve_release)
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
                connection.execute(text("SET LOCAL lock_timeout='5s'"))
                verify_database_target(connection, args.expected_database, args.expected_system_identifier)
                connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                if automatic:
                    from app.services import release_authorization as authorization
                    origin = authorization.authorize_fresh(
                        ROOT, connection, settings, receipt=args.validated_release,
                        trust_file=args.trust_config, recovery_receipt=args.recovery_evidence,
                        state_file=args.fresh_state, phase=args.phase, hostname=hostname)
                if args.phase == "prepare":
                    prepare(connection)
                    if automatic:
                        from app.services.fresh_recovery import snapshot
                        origin["prepared_snapshot_sha256"] = hashlib.sha256(
                            authorization.canonical(snapshot(connection))).hexdigest()
                else:
                    finalize(connection, settings, hostname)
            if automatic and args.phase == "prepare":
                # Commit first. If custody fails, the origin is absent and all
                # unattended continuation blocks; never invent a replacement.
                authorization.write_origin(args.fresh_state, ROOT, settings, origin)
        finally:
            engine.dispose()
        print("FRESH_INSTALL_PREPARED: 0031_role_hostnames; protected recovery/retirement required; NOT READY."
              if args.phase == "prepare" else f"FRESH_INSTALL_READY: {FINAL_TARGET}; Super Admin initialized.")
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
