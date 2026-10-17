#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export APP_ENV=development
export EVEXIA_MANAGED_PREVIEW=1
# Uvicorn's --app-dir adjusts only its own sys.path. Explicit diagnostics can
# launch Python children from the managed service's artifact directory.
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
# Preserve the separately approved additive database-sync policy, not a
# compatibility preflight or ingress verification.
python -B "$ROOT/scripts/development-sync.py"
# Compatibility diagnostics are manual-only; normal startup does not run them.
exec python -m uvicorn app.main:app --no-proxy-headers --app-dir "$ROOT/artifacts/api-server/backend" --host 0.0.0.0 --port "${PORT:-8080}"
