#!/usr/bin/env python3
"""Reviewed additive operator path: 0030 -> 0031_role_hostnames ONLY.

No head/target override, retirement approvals, service management or deployment.
Inspection is read-only. Execution uses the existing host and database locks.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import sysconfig

from hostname_recovery import ScopeError, canonical_digest, verified_recovery

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"
ACTIVE = Path("/var/www/admin-uat.allergyevexia.in")
LOCK = ACTIVE / ".deploy.lock"
MARKER = ACTIVE / ".operator-maintenance"
PREDECESSOR = "0030_directory_crypto_retirement"
TARGET = "0031_role_hostnames"
REVIEWED_HEAD = "0034_shared_phone_countries"
MIGRATION_SHA = "bdfac90ccb49b74fde49efabaa71bd51a9ff49cd85dbd05dcf292d52a9540b78"
ENV_SHA = "5b02495b411a1fa28c5a3a49c09d21eb94f02a9e80fb45a62b4270ea2a4c919d"


def runner_module():
    spec = importlib.util.spec_from_file_location("hostname_deployment_runner", ROOT / "scripts/deploy-migrations.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def file_digest(path):
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_source(release_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", release_sha or ""):
        raise ScopeError("PINNED_RELEASE_SHA_REQUIRED")
    actual = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                            capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    clean = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "HEAD", "--"],
                           capture_output=True, timeout=10)
    extra = subprocess.run(["git", "-C", str(ROOT), "ls-files", "--others", "--exclude-standard"],
                           capture_output=True, text=True, check=True, timeout=10).stdout.splitlines()
    # Lock/maintenance files belong to the active supervisor, not source code.
    permitted = {".deploy.lock", ".operator-maintenance"} if ROOT == ACTIVE else set()
    if actual != release_sha or clean.returncode or any(path not in permitted for path in extra):
        raise ScopeError("PINNED_CLEAN_CHECKOUT_REQUIRED")
    if (file_digest(BACKEND / "alembic/versions/0031_role_hostnames.py") != MIGRATION_SHA
            or file_digest(BACKEND / "alembic/env.py") != ENV_SHA):
        raise ScopeError("REVIEWED_MIGRATION_OR_ENVIRONMENT_CHANGED")


def verify_scope(runner, current):
    if current != [PREDECESSOR]:
        raise ScopeError("EXACT_PREDECESSOR_REQUIRED_NO_REPLAY")
    graph = runner.load_graph(BACKEND / "alembic/versions")
    policy = runner.load_policy(ROOT / "scripts/migration-policy.json")
    head = runner.literal_assignments(BACKEND / "app/core/schema.py", {"SCHEMA_REVISION"}).get("SCHEMA_REVISION")
    if head != REVIEWED_HEAD:
        raise ScopeError("CHANGED_RELEASE_REQUIRES_NEW_OPERATOR_REVIEW")
    # Preserve validation of the WHOLE reviewed graph and policy. This plan is
    # informational only; its broader path is NEVER passed to an execution API.
    broader = runner.plan(graph, policy, current, head)
    node = graph.get(TARGET)
    if (node is None or node.down_revision != (PREDECESSOR,) or node.depends_on
            or policy.get(TARGET) != "automatic"):
        raise ScopeError("HOSTNAME_MIGRATION_SCOPE_CHANGED")
    return broader["operator_only"]


def require_host_interlock():
    if os.environ.get("EVEXIA_DEPLOY_LOCK") != str(LOCK):
        raise ScopeError("CANONICAL_DEPLOY_LOCK_REQUIRED")
    descriptor = os.environ.get("EVEXIA_DEPLOY_LOCK_FD", "")
    if not descriptor.isdigit() or int(descriptor) < 3:
        raise ScopeError("INHERITED_EXCLUSIVE_LOCK_REQUIRED")
    for path in (LOCK, MARKER):
        if path != path.resolve() or not stat.S_ISREG(path.lstat().st_mode):
            raise ScopeError("CANONICAL_LOCK_AND_MAINTENANCE_MARKER_REQUIRED")
    opened, named = os.fstat(int(descriptor)), LOCK.stat(follow_symlinks=False)
    if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino):
        raise ScopeError("INHERITED_LOCK_INODE_MISMATCH")
    lines = Path(f"/proc/self/fdinfo/{int(descriptor)}").read_text().splitlines()
    if not any(len(parts := line.split()) >= 5 and parts[0] == "lock:"
               and parts[2:5] == ["FLOCK", "ADVISORY", "WRITE"] for line in lines):
        raise ScopeError("SUPERVISOR_HELD_EXCLUSIVE_LOCK_REQUIRED")


def inspect_database(connection, runner, release_sha):
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.services.directory_runtime import ready
    with connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        connection.execute(text("SET LOCAL statement_timeout = '10s'"))
        current = list(connection.execute(text("SELECT version_num FROM alembic_version")).scalars())
        protected = verify_scope(runner, current)
        identity = dict(connection.execute(text(
            "SELECT current_database() AS database, current_schema() AS schema, "
            "inet_server_addr()::text AS server, inet_server_port() AS port, "
            "current_setting('search_path') AS search_path"
        )).mappings().one())
        if not identity["schema"]:
            raise ScopeError("INTENDED_SCHEMA_REQUIRED")
        # Reject any target-schema relation or search-path-visible collision.
        # Unrelated isolated schemas in the same DB do not become our target.
        if connection.scalar(text(
            "SELECT count(*) FROM pg_class WHERE relname='role_hostnames' AND "
            "(relnamespace=to_regnamespace(current_schema()) OR pg_table_is_visible(oid))"
        )):
            raise ScopeError("HOSTNAME_RELATION_ALREADY_EXISTS_OR_CONFLICTS")
        for table in ("users", "alembic_version"):
            if not connection.scalar(text(
                "SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(:table) "
                "AND relnamespace=to_regnamespace(current_schema()))"
            ), {"table": table}):
                raise ScopeError("PREDECESSOR_TABLES_MUST_BELONG_TO_INTENDED_SCHEMA")
        connection.execute(text("SELECT id FROM users LIMIT 0"))
        with Session(bind=connection) as session:
            ready(session)  # Existing encryption/configuration/logging gates.
    return {
        "format": 1, "release_sha": release_sha, "current": current,
        "only_migration": TARGET, "migration_sha256": MIGRATION_SHA, "environment_sha256": ENV_SHA,
        "target_fingerprints": {name: canonical_digest(value) for name, value in identity.items()},
        "broader_release_operator_only": protected,
    }


def migration_command():
    # Deliberately no argument for a caller-selected target or extra Alembic flags.
    return [sys.executable, "-B", "-m", "alembic", "-c", str(BACKEND / "alembic.ini"),
            "upgrade", TARGET]


def migration_environment():
    """Carry installed dependencies, never the parent's arbitrary source paths."""
    env = dict(os.environ)
    active = {Path(entry).resolve() for entry in sys.path if entry and Path(entry).is_absolute()}
    # The CI interpreter is outside uv's locked project environment. Its
    # sysconfig paths alone therefore do not include the installed dependencies.
    installed = [
        Path(sysconfig.get_path("purelib")),
        Path(sysconfig.get_path("platlib")),
        ROOT / ".pythonlibs" / "lib"
        / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages",
    ]
    paths = [BACKEND.resolve()]
    for candidate in installed:
        candidate = candidate.resolve()
        if candidate in active and candidate.is_dir() and candidate not in paths:
            paths.append(candidate)
    env["PYTHONPATH"] = os.pathsep.join(map(str, paths))
    return env


def verify_result(connection, runner):
    from sqlalchemy import inspect, text
    with connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        connection.execute(text("SET LOCAL statement_timeout = '10s'"))
        if list(connection.execute(text("SELECT version_num FROM alembic_version")).scalars()) != [TARGET]:
            raise ScopeError("POST_MIGRATION_REVISION_MISMATCH")
        schema = connection.scalar(text("SELECT current_schema()"))
        inspector = inspect(connection)
        columns = inspector.get_columns("role_hostnames", schema=schema)
        expected = {"id", "hostname", "role", "enabled", "version", "created_by",
                    "updated_by", "created_at", "updated_at"}
        if {col["name"] for col in columns} != expected or any(col["nullable"] for col in columns):
            raise ScopeError("POST_MIGRATION_PROJECTION_MISMATCH")
        if inspector.get_pk_constraint("role_hostnames", schema=schema)["constrained_columns"] != ["id"]:
            raise ScopeError("POST_MIGRATION_PRIMARY_KEY_MISMATCH")
        unique = inspector.get_unique_constraints("role_hostnames", schema=schema)
        if not any(row["column_names"] == ["hostname"] for row in unique):
            raise ScopeError("POST_MIGRATION_UNIQUENESS_MISMATCH")
        checks = inspector.get_check_constraints("role_hostnames", schema=schema)
        if {row["name"] for row in checks} != {
            "ck_role_hostnames_role", "ck_role_hostnames_version", "ck_role_hostnames_canonical",
        }:
            raise ScopeError("POST_MIGRATION_CHECKS_MISMATCH")
        foreign = inspector.get_foreign_keys("role_hostnames", schema=schema)
        if {(tuple(row["constrained_columns"]), row["referred_table"], tuple(row["referred_columns"]))
                for row in foreign} != {
                    (("created_by",), "users", ("id",)), (("updated_by",), "users", ("id",)),
                }:
            raise ScopeError("POST_MIGRATION_FOREIGN_KEYS_MISMATCH")
        if connection.scalar(text("SELECT count(*) FROM role_hostnames")) != 0:
            raise ScopeError("UNEXPECTED_HOSTNAME_DATA")


def execute_scoped(connection, runner, args, plan, progress=None):
    progress = progress if progress is not None else {}
    if not (args.approve_hostnames and args.writers_stopped and args.recovery_reviewed):
        raise ScopeError("SCOPED_APPROVAL_WRITER_EXCLUSION_RECOVERY_REVIEW_REQUIRED")
    if args.approval != canonical_digest(plan):
        raise ScopeError("EXACT_PLAN_APPROVAL_REQUIRED")
    if not args.backup or not args.recovery_evidence:
        raise ScopeError("BACKUP_AND_REHEARSAL_EVIDENCE_REQUIRED")
    with verified_recovery(args.backup, args.recovery_evidence, plan, ROOT, ACTIVE):
        # Last checks under the existing DB advisory lock, immediately before DDL.
        require_host_interlock()
        verify_source(args.release_sha)
        if inspect_database(connection, runner, args.release_sha) != plan:
            raise ScopeError("PLAN_CHANGED")
        env = migration_environment()
        # Time bounds fail closed. A timeout is an unconfirmed outcome, never
        # permission to retry automatically, downgrade, stamp, or reopen traffic.
        progress["attempted"] = True
        completed = subprocess.run(migration_command(), cwd=BACKEND, env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        if completed.returncode:
            raise ScopeError("MIGRATION_FAILED_OR_UNCONFIRMED_KEEP_MAINTENANCE")
        verify_result(connection, runner)
    return {"result": "HOSTNAME_MIGRATION_APPLIED", "revision": TARGET,
            "migrations_applied": 1, "full_release_readiness": "not_established"}


def parser():
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise ScopeError("INVALID_SCOPED_OPERATOR_ARGUMENTS")
    result = Parser(description=__doc__, allow_abbrev=False)
    mode = result.add_mutually_exclusive_group(required=True)
    mode.add_argument("--inspect", action="store_true")
    mode.add_argument("--execute", action="store_true")
    result.add_argument("--release-sha", required=True)
    result.add_argument("--approval")
    result.add_argument("--approve-hostnames", action="store_true")
    result.add_argument("--writers-stopped", action="store_true")
    result.add_argument("--recovery-reviewed", action="store_true")
    result.add_argument("--backup")
    result.add_argument("--recovery-evidence")
    return result


def main(argv=None):
    progress = {"attempted": False}
    try:
        args = parser().parse_args(argv)
        if os.environ.get("APP_ENV") != "production":
            raise ScopeError("PRODUCTION_ENVIRONMENT_REQUIRED")
        if args.inspect and any((args.approval, args.approve_hostnames, args.writers_stopped,
                                 args.recovery_reviewed, args.backup, args.recovery_evidence)):
            raise ScopeError("INSPECTION_CANNOT_AUTHORIZE_EXECUTION")
        verify_source(args.release_sha)
        runner = runner_module()
        if args.execute:
            require_host_interlock()
            if not (args.approve_hostnames and args.writers_stopped and args.recovery_reviewed
                    and args.backup and args.recovery_evidence and args.approval):
                raise ScopeError("ALL_SCOPED_EXECUTION_EVIDENCE_REQUIRED")
        # Reuse the production-only connection/driver and shared session DB lock.
        with runner.production_connection(BACKEND) as connection:
            plan = inspect_database(connection, runner, args.release_sha)
            if args.inspect:
                result = {"result": "READ_ONLY_HOSTNAME_PLAN", "plan": plan, "plan_sha256": canonical_digest(plan)}
            else:
                result = execute_scoped(connection, runner, args, plan, progress)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        # Even configuration/DB exceptions can contain credential-bearing URLs.
        print(json.dumps({"result": "SCOPED_OPERATOR_BLOCKED_OR_UNCONFIRMED",
                          "reason": str(exc) if isinstance(exc, ScopeError)
                          and re.fullmatch(r"[A-Z0-9_]+", str(exc)) else "PRIVATE_CONFIGURATION_OR_DATABASE_CHECK_FAILED",
                          "mutation_outcome": "unconfirmed" if progress["attempted"] else "not_attempted",
                          "action": "keep_existing_maintenance_and_review_private_evidence"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
