#!/usr/bin/env bash
# Deliberate host/operator workflow. Never called by push-triggered deployment.
# Run with the pinned release's installed Python environment and production
# settings supplied securely. This script does not stop external writers for you.
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKEND="$ROOT/artifacts/api-server/backend"
PYTHON="${EVEXIA_OPERATOR_PYTHON:-python3}"
BACKUP= SHA= RESTORE=
APPROVED=no WRITERS=no CONSUMERS=no DURABLE=no RETENTION=no PHONE=no
while (($#)); do
  case "$1" in
    --backup) BACKUP="${2:?Missing backup path}"; shift 2 ;;
    --sha256) SHA="${2:?Missing digest}"; shift 2 ;;
    --restore-verified) RESTORE="${2:?Missing rehearsal digest}"; shift 2 ;;
    --approve-retirement) APPROVED=yes; shift ;;
    --writers-stopped) WRITERS=yes; shift ;;
    --external-consumers-reviewed) CONSUMERS=yes; shift ;;
    --backup-durable) DURABLE=yes; shift ;;
    --retention-resolved) RETENTION=yes; shift ;;
    --approve-phone-continuation) PHONE=yes; shift ;;
    *) echo "Unknown operator argument; no migration executed." >&2; exit 1 ;;
  esac
done
[[ "${APP_ENV:-}" == production ]] || { echo "Production environment required." >&2; exit 1; }
[[ "$APPROVED$WRITERS$CONSUMERS$DURABLE$RETENTION$PHONE" == yesyesyesyesyesyes ]] ||
  { echo "All explicit operator attestations and continuation approval are required." >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{64}$ && "$RESTORE" == "$SHA" && -n "$BACKUP" ]] ||
  { echo "Exact backup and restoration-rehearsal digest required." >&2; exit 1; }
[[ -f "$BACKUP" && ! -L "$BACKUP" ]] ||
  { echo "Regular restricted recovery file required." >&2; exit 1; }
: "${EVEXIA_DEPLOY_LOCK:?Set the same absolute lock path used by normal VPS deployment}"
[[ "$EVEXIA_DEPLOY_LOCK" == /* ]] || { echo "Absolute deployment lock path required." >&2; exit 1; }
: "${EVEXIA_DEPLOY_LOCK_FD:?An operator supervisor must hold the host lock through reopening traffic}"
[[ "$EVEXIA_DEPLOY_LOCK_FD" =~ ^[0-9]+$ ]] ||
  { echo "Inherited deployment lock descriptor required." >&2; exit 1; }
[[ "$EVEXIA_DEPLOY_LOCK" -ef "/proc/$$/fd/$EVEXIA_DEPLOY_LOCK_FD" ]] ||
  { echo "Inherited descriptor does not identify the shared host lock." >&2; exit 1; }
MAINTENANCE="${EVEXIA_DEPLOY_LOCK%/*}/.operator-maintenance"
[[ -f "$MAINTENANCE" && ! -L "$MAINTENANCE" ]] ||
  { echo "Shared maintenance marker required before stopping writers." >&2; exit 1; }
command -v flock >/dev/null
command -v "$PYTHON" >/dev/null
flock -n "$EVEXIA_DEPLOY_LOCK_FD" ||
  { echo "Shared deployment lock unavailable." >&2; exit 1; }
cd "$BACKEND"
export PYTHONPATH="$BACKEND${PYTHONPATH:+:$PYTHONPATH}"
# Session-level DB lock is shared with the automatic runner. It spans the
# predecessor, protected retirement and continuation, including child processes.
"$PYTHON" - "$ROOT" "$BACKUP" "$SHA" "$RESTORE" <<'PY'
import importlib.util
from pathlib import Path
import subprocess
import sys

root, backup, digest, restored = sys.argv[1:]
spec = importlib.util.spec_from_file_location("deployment_migrations", Path(root) / "scripts/deploy-migrations.py")
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)
backend = Path(root) / "artifacts/api-server/backend"

def upgrade(target, arguments=()):
    command = [sys.executable, "-m", "alembic", "-c", str(backend / "alembic.ini")]
    for argument in arguments:
        command += ["-x", argument]
    command += ["upgrade", target]
    if subprocess.run(command, cwd=backend, capture_output=True).returncode:
        raise runner.PolicyError("OPERATOR_STEP_FAILED; keep writers stopped and follow reviewed recovery")

try:
    graph = runner.load_graph(backend / "alembic/versions")
    policy = runner.load_policy(Path(root) / "scripts/migration-policy.json")
    target = runner.literal_assignments(backend / "app/core/schema.py", {"SCHEMA_REVISION"})["SCHEMA_REVISION"]
    if target != "0034_shared_phone_countries":
        raise runner.PolicyError("OPERATOR_WORKFLOW_REQUIRES_REVIEW_FOR_CHANGED_RELEASE")
    with runner.production_connection(backend) as connection:
        current = runner.applied_revisions(connection)
        runner.plan(graph, policy, current, target)
        if current == [target]:
            print("Operator continuation already applied; no migration executed.")
        else:
            if current not in (["0030_directory_crypto_retirement"], ["0031_role_hostnames"]):
                raise runner.PolicyError("UNEXPECTED_OPERATOR_START_STATE; reviewed recovery required")
            # Validate encryption and backup/rehearsal evidence BEFORE advancing
            # even the role-hostname predecessor. The migration validates again.
            from app.core.config import get_settings
            from app.services.directory_crypto import DirectoryCrypto
            from app.services import organization_retirement
            DirectoryCrypto(get_settings())
            recovery = organization_retirement.load_backup(backup, digest)
            if not recovery or restored != digest:
                raise runner.PolicyError("RECOVERY_EVIDENCE_REQUIRED")
            if current == ["0030_directory_crypto_retirement"]:
                upgrade("0031_role_hostnames")
            # Existing preflight is read-only; all original migration gates remain.
            if subprocess.run([sys.executable, "-m", "app.organization_preflight"],
                              cwd=backend, capture_output=True).returncode:
                raise runner.PolicyError("RETIREMENT_PREFLIGHT_FAILED")
            upgrade("0031_remove_organizations", (
                "organization_removal_approved=yes", "organization_writers_stopped=yes",
                "organization_external_consumers_reviewed=yes", "organization_backup_durable=yes",
                "organization_retention_resolved=yes", f"organization_backup={backup}",
                f"organization_backup_sha256={digest}", f"organization_restore_verified={restored}",
            ))
            upgrade("0033_merge_directory_branches")
            upgrade("0034_shared_phone_countries")
            if runner.applied_revisions(connection) != [target]:
                raise runner.PolicyError("OPERATOR_FINAL_REVISION_MISMATCH")
            print("Operator migration continuation complete. Verify encryption readiness before starting matching application.")
except Exception:
    # Never expose restricted recovery content or raw database exception text.
    print("OPERATOR_ROLLOUT_FAILED: keep writers stopped; use restricted evidence and reviewed recovery.", file=sys.stderr)
    sys.exit(1)
PY
