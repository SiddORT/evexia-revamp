#!/usr/bin/env python3
"""Fail-closed deployment planner. Offline mode never connects to a database.

Normal execution accepts no Alembic approval arguments. Historical migrations
are parsed, not imported, while planning. Live execution is production-only.
"""
import argparse
import ast
from contextlib import contextmanager
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

READY = 0
ERROR = 1
OPERATOR_REQUIRED = 42
LOCK_ID = 145002
ROOT = Path(__file__).resolve().parents[1]


class PolicyError(Exception):
    """Safe operational message: never wrap raw database/credential errors."""

    def __init__(self, message, mutation_attempted=False):
        super().__init__(message)
        self.mutation_attempted = mutation_attempted


class AutomaticPolicy(dict):
    """Version 2: literal, graph-validated revisions default to automatic."""
    default = "automatic"

    def __missing__(self, revision):
        return self.default


@dataclass(frozen=True)
class Revision:
    revision: str
    down_revision: tuple = ()
    depends_on: tuple = ()

    @property
    def parents(self):
        return tuple(dict.fromkeys((*self.down_revision, *self.depends_on)))


def identifiers(value):
    if value is None:
        return ()
    values = (value,) if isinstance(value, str) else value
    if not isinstance(values, (tuple, list)) or not values:
        raise PolicyError("INVALID_REVISION_METADATA")
    if any(not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9_]+", v) for v in values):
        raise PolicyError("INVALID_REVISION_IDENTIFIER")
    if any(v in {"head", "heads", "base"} for v in values):
        raise PolicyError("SYMBOLIC_REVISION_IDENTIFIER_FORBIDDEN")
    if len(set(values)) != len(values):
        raise PolicyError("DUPLICATE_PARENT")
    return tuple(values)


def literal_assignments(path, names):
    result = {}
    try:
        tree = ast.parse(path.read_text())
        for statement in tree.body:
            if isinstance(statement, ast.Assign):
                for target in statement.targets:
                    if isinstance(target, ast.Name) and target.id in names:
                        if target.id in result:
                            raise PolicyError("DUPLICATE_METADATA_ASSIGNMENT")
                        result[target.id] = ast.literal_eval(statement.value)
    except (OSError, SyntaxError, ValueError, TypeError):
        raise PolicyError("NON_LITERAL_OR_UNREADABLE_METADATA") from None
    return result


def load_graph(directory):
    graph = {}
    for path in sorted(directory.glob("*.py")):
        if path.name == "__init__.py":
            continue
        fields = literal_assignments(path, {"revision", "down_revision", "depends_on"})
        if "revision" not in fields or "down_revision" not in fields:
            raise PolicyError("MISSING_REVISION_METADATA")
        revision = identifiers(fields["revision"])
        if len(revision) != 1 or revision[0] in graph:
            raise PolicyError("DUPLICATE_OR_INVALID_REVISION")
        graph[revision[0]] = Revision(
            revision[0], identifiers(fields["down_revision"]),
            identifiers(fields.get("depends_on")),
        )
    if not graph:
        raise PolicyError("EMPTY_MIGRATION_GRAPH")
    return graph


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PolicyError("DUPLICATE_POLICY_KEY")
        result[key] = value
    return result


def load_policy(path):
    try:
        data = json.loads(path.read_text(), object_pairs_hook=unique_object)
    except (OSError, ValueError):
        raise PolicyError("UNREADABLE_POLICY") from None
    if not isinstance(data, dict) or type(data.get("version")) is not int:
        raise PolicyError("INVALID_POLICY")
    if data["version"] == 2:
        if (set(data) != {"version", "default", "revisions"}
                or data.get("default") != "automatic"
                or not isinstance(data.get("revisions"), dict)):
            raise PolicyError("INVALID_POLICY")
        if any(value != "automatic" for value in data["revisions"].values()):
            raise PolicyError("INVALID_POLICY_CLASSIFICATION")
        return AutomaticPolicy(data["revisions"])
    if (data["version"] != 1 or set(data) != {"version", "revisions"}
            or not isinstance(data["revisions"], dict)):
        raise PolicyError("INVALID_POLICY")
    if any(value not in ("automatic", "operator_only") for value in data["revisions"].values()):
        raise PolicyError("INVALID_POLICY_CLASSIFICATION")
    return data["revisions"]


def ordered_ancestors(graph, target):
    ordered, done, visiting = [], set(), set()

    def visit(revision):
        if revision not in graph:
            raise PolicyError("UNKNOWN_REVISION_OR_DEPENDENCY")
        if revision in visiting:
            raise PolicyError("CYCLIC_MIGRATION_GRAPH")
        if revision in done:
            return
        visiting.add(revision)
        for parent in graph[revision].parents:
            visit(parent)
        visiting.remove(revision)
        done.add(revision)
        ordered.append(revision)

    visit(target)
    return ordered


def validate_classifications(graph, policy):
    """A v2 default covers new graph revisions, never unknown DB revisions."""
    if (set(policy) - set(graph)
            or (set(graph) - set(policy) and getattr(policy, "default", None) != "automatic")):
        raise PolicyError("UNKNOWN_OR_UNCLASSIFIED_MIGRATION")
    if any(value not in ("automatic", "operator_only") for value in policy.values()):
        raise PolicyError("INVALID_POLICY_CLASSIFICATION")


def plan(graph, policy, current, target):
    down_parents = {p for node in graph.values() for p in node.down_revision}
    heads = set(graph) - down_parents
    if len(heads) != 1:
        raise PolicyError("MULTIPLE_OR_MISSING_SOURCE_HEADS")
    if target not in graph or heads != {target}:
        raise PolicyError("APPLICATION_REQUIREMENT_NOT_SOURCE_HEAD")
    # Validate the whole source graph/policy, not just the first pending step.
    for revision in graph:
        ordered_ancestors(graph, revision)
    validate_classifications(graph, policy)
    if len(current) != 1 or current[0] not in graph:
        raise PolicyError("UNEXPECTED_DATABASE_REVISION_STATE")
    required = ordered_ancestors(graph, target)
    if current[0] not in required:
        raise PolicyError("DATABASE_REVISION_NOT_TARGET_ANCESTOR")
    applied = set(ordered_ancestors(graph, current[0]))
    pending = [revision for revision in required if revision not in applied]
    protected = [revision for revision in pending if policy[revision] == "operator_only"]
    return {
        "result": "OPERATOR_MIGRATION_REQUIRED" if protected else "READY",
        "current": list(current),
        "required": target,
        "pending": pending,
        "operator_only": protected,
        "migrations_applied": 0,
    }


def upgrade_command(backend, target):
    # Target has already been validated against literal graph revision IDs.
    return [sys.executable, "-m", "alembic", "-c", str(backend / "alembic.ini"),
            "upgrade", target]


@contextmanager
def production_connection(backend):
    if os.environ.get("APP_ENV") != "production":
        raise PolicyError("PRODUCTION_ENVIRONMENT_REQUIRED")
    sys.path.insert(0, str(backend))
    engine = None
    try:
        from sqlalchemy import create_engine, text
        from app.core.config import get_settings
        from app.services.organization_retirement import connection_url
        settings = get_settings()
        if settings.app_env != "production":
            raise PolicyError("PRODUCTION_ENVIRONMENT_REQUIRED")
        engine = create_engine(connection_url(settings.database_url), hide_parameters=True)
        with engine.connect() as connection:
            # A session-level lock coordinates invocations on different hosts.
            # Alembic still uses its existing transaction/connection behavior.
            connection.execute(text("SET statement_timeout = '60s'"))
            connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": LOCK_ID})
            connection.commit()
            try:
                yield connection
            finally:
                connection.rollback()
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_ID})
                connection.commit()
    except PolicyError:
        raise
    except Exception:
        raise PolicyError("DATABASE_OR_CONFIGURATION_UNAVAILABLE") from None
    finally:
        if engine is not None:
            engine.dispose()


def applied_revisions(connection):
    from sqlalchemy import text
    with connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        return list(connection.execute(text("SELECT version_num FROM alembic_version")).scalars())


def execute_plan(connection, graph, policy, backend, target, execute):
    result = plan(graph, policy, applied_revisions(connection), target)
    if result["operator_only"] or not execute or not result["pending"]:
        return result
    # Automatic execution is not restricted to an AST DDL allowlist.
    # Actual migration guards and failures remain authoritative.
    # No approval flags, injected arguments, or unconditional head upgrade.
    try:
        completed = subprocess.run(upgrade_command(backend, target), cwd=backend,
                                   capture_output=True, check=False, timeout=600,
                                   env={**os.environ, "PGOPTIONS":
                                        os.environ.get("PGOPTIONS", "") +
                                        " -c lock_timeout=10000 -c statement_timeout=60000"})
        if completed.returncode:
            raise PolicyError("MIGRATION_EXECUTION_FAILED", mutation_attempted=True)
        if applied_revisions(connection) != [target]:
            raise PolicyError("POST_MIGRATION_REVISION_MISMATCH", mutation_attempted=True)
    except PolicyError:
        raise
    except Exception:
        raise PolicyError("MIGRATION_RESULT_UNCONFIRMED", mutation_attempted=True) from None
    result["migrations_applied"] = len(result["pending"])
    return result


def validate_additive(backend, pending):
    """Use the same conservative DDL allowlist as development."""
    spec = importlib.util.spec_from_file_location(
        "deployment_additive", Path(__file__).resolve().with_name("development-sync.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    paths = {literal_assignments(p, {"revision"})["revision"]: p
             for p in (backend / "alembic/versions").glob("*.py")}
    try:
        for revision in pending:
            module.additive(paths[revision])
    except Exception:
        raise PolicyError("AUTOMATIC_MIGRATION_NOT_ADDITIVE") from None


def main(argv=None):
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise PolicyError("INVALID_COMMAND_ARGUMENTS")

    parser = Parser(description=__doc__)
    parser.add_argument("--backend-dir", type=Path,
                        default=ROOT / "artifacts/api-server/backend")
    parser.add_argument("--policy", type=Path, default=ROOT / "scripts/migration-policy.json")
    parser.add_argument("--execute", action="store_true",
                        help="Apply a completely automatic path, after production inspection.")
    parser.add_argument("--validated-release", type=Path)
    parser.add_argument("--ci-report", type=Path)
    parser.add_argument("--trust-config", type=Path)
    parser.add_argument("--release-root", type=Path, default=ROOT)
    parser.add_argument("--expected-commit")
    parser.add_argument("--offline-current", action="append",
                        help="Source-only example/test; cannot be combined with --execute.")
    try:
        args = parser.parse_args(argv)
        if args.execute and args.offline_current is not None:
            raise PolicyError("OFFLINE_EXECUTION_FORBIDDEN")
        if args.execute:
            if args.ci_report:
                if not args.expected_commit or args.validated_release or args.trust_config:
                    raise PolicyError("INVALID_CI_VALIDATION_ARGUMENTS")
                sys.path.insert(0, str(args.backend_dir.resolve()))
                from app.services import release_authorization as authorization
                try:
                    authorization.ci_report(args.release_root.resolve(), args.ci_report, args.expected_commit)
                except Exception:
                    raise PolicyError("CI_VALIDATION_FAILED") from None
            elif not all((args.validated_release, args.trust_config, args.expected_commit)):
                raise PolicyError("VALIDATED_RELEASE_REQUIRED")
        if args.execute and not args.ci_report:
            # Legacy signed operator tooling remains supported separately.
            sys.path.insert(0, str(args.backend_dir.resolve()))
            from app.services import release_authorization as authorization
            authorization.release(args.release_root.resolve(), args.validated_release, args.trust_config)
            if authorization.sha(args.policy) != authorization.sha(
                    args.release_root / "scripts/migration-policy.json"):
                raise PolicyError("VALIDATED_POLICY_MISMATCH")
            config = authorization.trust(args.trust_config, args.release_root.resolve())
            evidence = authorization.signed(args.validated_release, config["release_public_key"],
                                            args.release_root.resolve())
            if evidence["commit"] != args.expected_commit:
                raise PolicyError("VALIDATED_COMMIT_MISMATCH")
        if args.execute:
            if authorization.sha(args.policy) != authorization.sha(
                    args.release_root / "scripts/migration-policy.json"):
                raise PolicyError("VALIDATED_POLICY_MISMATCH")
            for directory in ("app", "alembic"):
                for path in args.backend_dir.joinpath(directory).rglob("*.py"):
                    corresponding = (args.release_root / "artifacts/api-server/backend"
                                     / path.relative_to(args.backend_dir))
                    if not corresponding.is_file() or authorization.sha(path) != authorization.sha(corresponding):
                        raise PolicyError("VALIDATED_BACKEND_MISMATCH")
        backend = args.backend_dir.resolve()
        graph = load_graph(backend / "alembic/versions")
        policy = load_policy(args.policy)
        target = literal_assignments(backend / "app/core/schema.py",
                                     {"SCHEMA_REVISION"}).get("SCHEMA_REVISION")
        if args.offline_current is not None:
            result = plan(graph, policy, args.offline_current, target)
        else:
            with production_connection(backend) as connection:
                result = execute_plan(connection, graph, policy, backend, target, args.execute)
        print(json.dumps(result, sort_keys=True))
        return OPERATOR_REQUIRED if result["operator_only"] else READY
    except PolicyError as error:
        print(json.dumps({"result": "ERROR", "reason": str(error),
                          "migrations_applied": None if error.mutation_attempted else 0}))
        return ERROR


if __name__ == "__main__":
    sys.exit(main())
