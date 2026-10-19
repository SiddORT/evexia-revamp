#!/usr/bin/env python3
"""Offline development source review. Never connects to a database or approves activation.

--refresh deliberately records reviewed bytes and generates the application constant;
it does not change migration classifications or production fresh-install evidence.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EXECUTION_SOURCES = (
    "scripts/review-development-schema.py",
    "scripts/development-sync.py",
    "scripts/deploy-migrations.py",
    "scripts/development-database.json",
    "artifacts/api-server/backend/alembic/env.py",
)


class ReviewBlocked(ValueError):
    pass


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source(root):
    spec = importlib.util.spec_from_file_location("development_migration_planner",
                                                 root / "scripts/deploy-migrations.py")
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    backend = root / "artifacts/api-server/backend"
    declaration = json.loads((root / "development-contract.json").read_text(),
                             object_pairs_hook=runner.unique_object)
    if (set(declaration) != {"format", "contract", "schema"}
            or type(declaration["format"]) is not int or declaration["format"] != 1
            or not all(isinstance(declaration[k], str) and declaration[k]
                       for k in ("contract", "schema"))):
        raise ReviewBlocked("INVALID_DEVELOPMENT_DECLARATION")
    target = declaration["schema"]
    graph = runner.load_graph(backend / "alembic/versions")
    policy = runner.load_policy(root / "scripts/migration-policy.json")
    # A merged, classified migration may be staged beyond the approved development
    # contract. Validate the ENTIRE graph first, including its single head, policy,
    # dependencies and target ancestry. Do not advance the contract or authorize
    # those staged migrations. Production's strict source-head planner is unchanged.
    heads = set(graph) - {p for node in graph.values() for p in node.down_revision}
    if len(heads) != 1:
        raise ReviewBlocked("MULTIPLE_OR_MISSING_SOURCE_HEADS")
    runner.plan(graph, policy, [target], next(iter(heads)))
    paths = {runner.literal_assignments(p, {"revision"})["revision"]: p
             for p in (backend / "alembic/versions").glob("*.py") if p.name != "__init__.py"}
    approved_path = set(runner.ordered_ancestors(graph, target))
    graph = {r: node for r, node in graph.items() if r in approved_path}
    policy = {r: classification for r, classification in policy.items()
              if r in approved_path}
    return runner, graph, policy, target, paths


def manifest(root, target, paths):
    return {
        "version": 1,
        "target": target,
        "policy_sha256": sha(root / "scripts/migration-policy.json"),
        "revisions": {r: sha(p) for r, p in sorted(paths.items())},
        "execution_sources": {p: sha(root / p) for p in EXECUTION_SOURCES},
    }


def review(root=ROOT):
    # Check executable planner/environment bytes BEFORE importing the planner.
    approved = json.loads((root / "scripts/development-schema-review.json").read_text())
    expected_sources = {p: sha(root / p) for p in EXECUTION_SOURCES}
    if approved.get("execution_sources") != expected_sources:
        raise ReviewBlocked("DEVELOPMENT_EXECUTION_REVIEW_REQUIRED")
    runner, graph, policy, target, paths = source(root)
    constant = runner.literal_assignments(
        root / "artifacts/api-server/backend/app/core/schema.py", {"SCHEMA_REVISION"})
    if constant.get("SCHEMA_REVISION") != target:
        raise ReviewBlocked("GENERATED_APPLICATION_SCHEMA_DRIFT")
    approved = json.loads((root / "scripts/development-schema-review.json").read_text(),
                          object_pairs_hook=runner.unique_object)
    if approved != manifest(root, target, paths):
        raise ReviewBlocked("DEVELOPMENT_MIGRATION_REVIEW_REQUIRED")
    return runner, graph, policy, target, paths


def refresh(root=ROOT):
    _, _, _, target, paths = source(root)
    (root / "artifacts/api-server/backend/app/core/schema.py").write_text(
        '"""Generated coordinated schema; author development-contract.json instead."""\n\n'
        f'SCHEMA_REVISION = {json.dumps(target)}\n')
    (root / "scripts/development-schema-review.json").write_text(
        json.dumps(manifest(root, target, paths), indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    try:
        if args.refresh:
            refresh()
        review()
        print("DEVELOPMENT_SCHEMA_CONSISTENT: source only; no activation authorization")
    except Exception as exc:
        # Never expose arbitrary filesystem, connection or configuration values.
        safe = str(exc) if isinstance(exc, ReviewBlocked) else type(exc).__name__
        print("DEVELOPMENT_SCHEMA_BLOCKED: " + safe, file=sys.stderr)
        sys.exit(1)
