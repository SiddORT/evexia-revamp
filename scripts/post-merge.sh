#!/bin/bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
pnpm install --frozen-lockfile
# Use Replit's existing managed Python package directory, not a new .venv.
UV_PROJECT_ENVIRONMENT="$ROOT/.pythonlibs" uv sync --frozen
# FastAPI owns the database schema. The template Drizzle schema is empty:
# never push it against the backend database.
# Generate integrity metadata mechanically; this is not a human approval gate.
python -B "$ROOT/scripts/review-development-schema.py" --refresh
# All migrations are automatic. Embedded historical migration guards remain.
APP_ENV=development python -B "$ROOT/scripts/development-sync.py"
# No compatibility preflight or ingress verification here.
# Operators explicitly run check:development / verify:development when needed.
