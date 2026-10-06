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
python3 -m alembic upgrade head
