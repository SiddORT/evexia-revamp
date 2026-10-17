#!/bin/sh
# Reproducible development-only tests. Never inherit a configured DB credential.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/scripts/release-timing.sh"
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
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_api_test?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL"
export APP_ENV=test
# Readiness now validates the shared Communication keyring too. Always use a
# distinct synthetic key in this disposable fixture, never an ambient live key.
export COMMUNICATION_ENCRYPTION_KEYS='{"primary":"RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY="}'
export COMMUNICATION_ENCRYPTION_KEY_ID=primary
export PORTAL_BOOTSTRAP_HOSTS= TRUSTED_PROXY_PEERS=
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary
export STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export DIRECTORY_ENCRYPTION_KEYS='{"primary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="}'
export DIRECTORY_ENCRYPTION_KEY_ID=primary
export DIRECTORY_INDEX_KEY=RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU=
# Synthetic, independent Communication material for this private fixture only.
# Override inherited operator configuration; never provision managed Secrets.
export COMMUNICATION_ENCRYPTION_KEYS='{"primary":"RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY="}'
export COMMUNICATION_ENCRYPTION_KEY_ID=primary
export JWT_SECRET=synthetic-isolated-tests-only-signing-key-not-a-live-credential
export SESSION_SECRET=synthetic-isolated-tests-only-session-key-not-a-live-credential
export SCANNER_BACKEND=unavailable
export STORAGE_BACKEND=local
export LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
CACHE=disabled
if [ -n "${EVEXIA_TEST_CACHE_ROOT:-}" ]; then
  CACHE=$(timed api:cache-restore python3 "$ROOT/scripts/test-fixture-cache.py" restore "$PGROOT" evexia_api_test)
fi
if [ "$CACHE" != "hit" ]; then
  timed api:initdb initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
fi
# No network listener. Every clone has its own private socket and PGDATA.
timed api:postgres pg_ctl -D "$PGROOT/data" -l "$PGROOT/server.log" \
  -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
if [ "$CACHE" != "hit" ]; then
  createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_api_test
fi
cd "$ROOT/artifacts/api-server/backend"
if [ "$CACHE" != "hit" ]; then
  timed api:migrate python3 -m alembic upgrade head
  if [ "$CACHE" = "miss" ]; then
    timed api:cache-save python3 "$ROOT/scripts/test-fixture-cache.py" save "$PGROOT" evexia_api_test
  fi
fi
timed api:pytest python3 -m pytest -q "$@"