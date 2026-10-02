#!/bin/sh
# Explicit operator initialization. Never called by application startup.
# DATABASE_URL and SUPER_ADMIN_INITIAL_PASSWORD must be supplied backend-only.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/artifacts/api-server/backend"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
python3 -m alembic upgrade head
python3 -m app.bootstrap