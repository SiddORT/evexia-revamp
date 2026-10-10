#!/bin/bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
pnpm install --frozen-lockfile
# Use Replit's existing managed Python package directory, not a new .venv.
UV_PROJECT_ENVIRONMENT="$ROOT/.pythonlibs" uv sync --frozen
# FastAPI owns the database schema. The template Drizzle schema is empty:
# never push it against the backend database.
# Apply reviewed forward migrations only; do not bootstrap or reset accounts.
cd "$ROOT/artifacts/api-server/backend"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
# Fail before schema changes when the encrypted directory runtime cannot load
# its operator-managed keys. Never generate, replace or reuse Staff keys here.
python3 - <<'PY'
import sys

from app.core.config import get_settings
from app.services.directory_crypto import DirectoryCrypto

try:
    DirectoryCrypto(get_settings())
except Exception:
    print(
        "Setup blocked before migration: directory encryption configuration is "
        "missing or invalid. Configure DIRECTORY_ENCRYPTION_KEYS (JSON keyring "
        "with the active DIRECTORY_ENCRYPTION_KEY_ID, default primary) and "
        "DIRECTORY_INDEX_KEY in Secrets. Use independent base64 32-byte keys; "
        "do not replace or reuse Staff keys. Existing directory data still "
        "requires the documented approved rollout.",
        file=sys.stderr,
    )
    sys.exit(1)
PY
python3 -m alembic upgrade head
