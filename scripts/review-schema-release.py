#!/usr/bin/env python3
"""Generate review metadata, never migration permission or a validation signature."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refresh(root=ROOT):
    declaration = json.loads((root / "development-contract.json").read_text())
    target = declaration["schema"]
    review_path = root / "scripts/fresh-install-review.json"
    review = json.loads(review_path.read_text())
    catalog = json.loads((root / "scripts/fresh-install-catalog.json").read_text())
    if target not in catalog:
        raise ValueError("A tested fresh catalog for this target must be supplied first")
    spec = importlib.util.spec_from_file_location("review_runner", root / "scripts/deploy-migrations.py")
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    versions = root / "artifacts/api-server/backend/alembic/versions"
    graph = runner.load_graph(versions)
    runner.plan(graph, runner.load_policy(root / "scripts/migration-policy.json"), [target], target)
    schema = root / "artifacts/api-server/backend/app/core/schema.py"
    schema.write_text('"""Generated coordinated schema; author development-contract.json instead."""\n\n'
                      f'SCHEMA_REVISION = {json.dumps(target)}\n')
    policy_path = root / "scripts/release-authorization-policy.json"
    authorization_policy = json.loads(policy_path.read_text())
    authorization_policy["final_target"] = target
    policy_path.write_text(json.dumps(authorization_policy, indent=2) + "\n")
    review["target"] = target
    review["review_scope"] = (
        f"Pinned PostgreSQL 17 fresh path through {target}. Empty-only atomic initialization "
        "requires live target identity, pristine catalog, valid encryption configuration and "
        "exact final catalog/readiness checks; it does not require external recovery receipts. "
        "Routine deployment requires complete exact-commit CI validation and graph-validated "
        "automatic migrations. No separate per-migration human approval is required. "
        "Embedded historical migration guards remain authoritative and are never bypassed. "
        "Legacy signed staged initialization remains available. This manifest alone is not "
        "evidence of passing validation or authorization to modify an existing database."
    )
    review["policy_sha256"] = sha(root / "scripts/migration-policy.json")
    review["authorization_policy_sha256"] = sha(root / "scripts/release-authorization-policy.json")
    review["revisions"] = {}
    for path in versions.glob("*.py"):
        revision = runner.literal_assignments(path, {"revision"})["revision"]
        review["revisions"][revision] = sha(path)
    for path in review["guard_sources"]:
        review["guard_sources"][path] = sha(root / "artifacts/api-server/backend" / path)
    for path in (
        "development-contract.json", "pyproject.toml", "uv.lock", "scripts/review-schema-release.py",
        "scripts/development-sync.py", "scripts/frontend-runtime.mjs",
        "scripts/verify-running-release.py", "scripts/development-database.json",
        "artifacts/api-server/backend/app/core/release_contract.py",
        "artifacts/api-server/backend/app/core/development_identity.py",
        "artifacts/api-server/backend/Dockerfile", "artifacts/evexia-portal/Dockerfile",
        "artifacts/evexia-portal/vite.config.js",
        "scripts/start-development-web.sh", "scripts/start-development-api.sh",
        "scripts/post-merge.sh", "scripts/development-identity.mjs",
        "artifacts/api-server/backend/app/initialize_database.py",
        "scripts/initialize-production.py", "scripts/initialize-api.sh",
    ):
        review["release_sources"][path] = sha(root / path)
    for path in review["release_sources"]:
        review["release_sources"][path] = sha(root / path)
    review_path.write_text(json.dumps(review, indent=2) + "\n")
    # Deliberately preserve status, policy, approval requirements and signatures.


def check():
    sys.path.insert(0, str(BACKEND))
    from app.fresh_install import reviewed_graph
    reviewed_graph()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    try:
        if args.refresh:
            refresh()
        check()
        print("SCHEMA_REVIEW_CONSISTENT: no execution or release authorization issued")
    except Exception as exc:
        print(f"SCHEMA_REVIEW_BLOCKED: {type(exc).__name__}", file=sys.stderr)
        sys.exit(1)
