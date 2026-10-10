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
python3 - <<'PY'
from sqlalchemy import create_engine, text
from app.core.config import get_settings
from app.services.organization_retirement import connection_url
from app.core.schema import SCHEMA_REVISION
try:
    with create_engine(connection_url(get_settings().database_url), hide_parameters=True).connect() as db, db.begin():
        db.execute(text("SET TRANSACTION READ ONLY"))
        current = db.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    if current != [SCHEMA_REVISION]:
        print("SCHEMA ROLLOUT BLOCKED: no database migration applied by post-merge. Follow docs/organization-retirement.md and docs/directory-encryption.md after separate operator approval; readiness stays unavailable.")
    else:
        print("Coordinated schema revision already applied; no migration needed.")
except Exception:
    print("SCHEMA STATUS UNVERIFIED: no database migration applied. Approved operator inspection is required.")
PY
