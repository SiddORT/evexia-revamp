#!/bin/bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
pnpm install --frozen-lockfile
# Use Replit's existing managed Python package directory, not a new .venv.
UV_PROJECT_ENVIRONMENT="$ROOT/.pythonlibs" uv sync --frozen
# FastAPI owns the database schema. The template Drizzle schema is empty:
# never push it against the backend database.
# Do not automatically cross the separately approved organization-retirement
# boundary (or its directory-encryption predecessors). Operator evidence and
# coordinated write exclusion cannot be supplied by unattended post-merge.
APP_ENV=development python -B "$ROOT/scripts/development-sync.py"
APP_ENV=development sh "$ROOT/scripts/development-preflight.sh"
# The platform reconciles managed workflows after this script. The frontend
# launcher then verifies BOTH newly running services and served build identity.
# Checking old processes here would block reconciliation on every real update.
