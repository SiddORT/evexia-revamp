#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export APP_ENV=development
export EVEXIA_MANAGED_PREVIEW=1
# Uvicorn's --app-dir adjusts only its own sys.path. Explicit diagnostics can
# launch Python children from the managed service's artifact directory.
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
# Refresh generated source integrity metadata without a separate approval.
python -B "$ROOT/scripts/review-development-schema.py" --refresh
# Automatic database sync, not compatibility preflight or ingress verification.
python -B "$ROOT/scripts/development-sync.py"
# Compatibility diagnostics are manual-only; normal startup does not run them.
if [ "${EVEXIA_DEVELOPMENT_LOCAL_UPLOADS:-0}" = 1 ]; then
  # Own both children, including shutdown. A scanner failure leaves uploads
  # fail-closed without taking unrelated API features offline.
  scanner_pid=
  api_pid=
  cleanup() {
    trap - 0
    if [ -n "$api_pid" ]; then kill -TERM "$api_pid" 2>/dev/null || true; fi
    if [ -n "$scanner_pid" ]; then kill -TERM "$scanner_pid" 2>/dev/null || true; fi
    if [ -n "$api_pid" ]; then wait "$api_pid" 2>/dev/null || true; fi
    if [ -n "$scanner_pid" ]; then wait "$scanner_pid" 2>/dev/null || true; fi
  }
  trap cleanup 0
  trap 'exit 143' TERM
  trap 'exit 130' INT
  bash "$ROOT/scripts/start-development-scanner.sh" &
  scanner_pid=$!
  python -m uvicorn app.main:app --no-proxy-headers --app-dir "$ROOT/artifacts/api-server/backend" --host 0.0.0.0 --port "${PORT:-8080}" &
  api_pid=$!
  wait "$api_pid"
  exit 0
fi
exec python -m uvicorn app.main:app --no-proxy-headers --app-dir "$ROOT/artifacts/api-server/backend" --host 0.0.0.0 --port "${PORT:-8080}"
