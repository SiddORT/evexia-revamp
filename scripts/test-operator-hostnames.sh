#!/bin/sh
# Hostname operator only. No head migration, managed database, or release wrapper.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${HOSTNAME_TEST_PYTHON:-python3}
for tool in initdb pg_ctl createdb "$PYTHON"; do
  command -v "$tool" >/dev/null || { echo "Missing hostname test prerequisite" >&2; exit 1; }
done
PGROOT=$(mktemp -d /tmp/evexia-hostname-test.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
cleanup() {
  pg_ctl -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM
# Synthetic fixture material only; never inherit a managed database or keyring.
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_hostname_test?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL" APP_ENV=test
export COMMUNICATION_ENCRYPTION_KEYS='{"primary":"RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY="}'
export COMMUNICATION_ENCRYPTION_KEY_ID=primary
export PR_ENCRYPTION_KEYS='{"primary":"R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0c="}'
export PR_ENCRYPTION_KEY_ID=primary
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary
export STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export DIRECTORY_ENCRYPTION_KEYS='{"primary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="}'
export DIRECTORY_ENCRYPTION_KEY_ID=primary
export DIRECTORY_INDEX_KEY=RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU=
export PORTAL_BOOTSTRAP_HOSTS= TRUSTED_PROXY_PEERS=
export JWT_SECRET=synthetic-hostname-tests-only-signing-key-not-a-live-credential
export SESSION_SECRET=synthetic-hostname-tests-only-session-key-not-a-live-credential
export SCANNER_BACKEND=unavailable STORAGE_BACKEND=local LOCAL_STORAGE_ROOT="$PGROOT/storage"
# These Replit startup hooks otherwise hide missing child PYTHONPATH entries.
unset REPLIT_PYTHONPATH PYTHONUSERBASE NIX_PYTHONPATH NIX_PYTHONEXECUTABLE NIX_PYTHONPREFIX
VERSION=$("$PYTHON" -B -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
export PYTHONPATH="$ROOT/artifacts/api-server/backend:$ROOT/.pythonlibs/lib/python$VERSION/site-packages"
"$PYTHON" -B -m unittest discover -s "$ROOT/scripts/tests" -p test_operator_hostnames.py -v
initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$PGROOT/data" -l "$PGROOT/server.log" \
  -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_hostname_test
cd "$ROOT/artifacts/api-server/backend"
"$PYTHON" -B -m pytest -q tests/test_operator_hostnames.py
