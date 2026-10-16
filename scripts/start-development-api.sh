#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export APP_ENV=development
export EVEXIA_MANAGED_PREVIEW=1
sh "$ROOT/scripts/development-preflight.sh"
# A candidate pass is NOT activation. The browser and verify command check ingress.
exec python -m uvicorn app.main:app --no-proxy-headers --app-dir "$ROOT/artifacts/api-server/backend" --host 0.0.0.0 --port "${PORT:-8080}"
