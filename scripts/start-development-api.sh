#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export APP_ENV=development
export EVEXIA_MANAGED_PREVIEW=1
# Uvicorn's --app-dir adjusts only its own sys.path. The runtime gate also
# launches Python children from the managed service's artifact directory.
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
python -B "$ROOT/scripts/development-sync.py"
sh "$ROOT/scripts/development-preflight.sh"
# A candidate pass is NOT activation. The browser and verify command check ingress.
exec python -m uvicorn app.main:app --no-proxy-headers --app-dir "$ROOT/artifacts/api-server/backend" --host 0.0.0.0 --port "${PORT:-8080}"
