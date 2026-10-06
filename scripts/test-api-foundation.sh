#!/bin/sh
# Reproducible development-only tests. Never inherit a configured DB credential.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for tool in initdb pg_ctl createdb python3; do
  command -v "$tool" >/dev/null || { echo "Missing test prerequisite: $tool" >&2; exit 1; }
done
PGROOT=$(mktemp -d /tmp/evexia-api-test.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
cleanup() {
  pg_ctl -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
# No network listener. Trust auth is confined to this private ephemeral socket.
pg_ctl -D "$PGROOT/data" -l "$PGROOT/server.log" \
  -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_api_test
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_api_test?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL"
export APP_ENV=test
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary
export STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export JWT_SECRET=synthetic-isolated-tests-only-signing-key-not-a-live-credential
export SCANNER_BACKEND=unavailable
export STORAGE_BACKEND=local
export LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
cd "$ROOT/artifacts/api-server/backend"
python3 -m alembic upgrade head
python3 -m pytest -q "$@"