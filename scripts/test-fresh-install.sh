#!/bin/sh
# Only two private, ephemeral PostgreSQL clusters; never inherit a DB credential.
# Production-mode guard coverage, with independent pg_dump/pg_restore rehearsal.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for tool in initdb pg_ctl createdb pg_dump pg_restore python3; do
  command -v "$tool" >/dev/null || { echo "Missing test prerequisite: $tool" >&2; exit 1; }
done
PGROOT=$(mktemp -d /tmp/evexia-fresh-install.XXXXXX)
chmod 700 "$PGROOT"
cleanup() {
  for cluster in source rehearsal; do
    pg_ctl -D "$PGROOT/$cluster/data" -m immediate stop >/dev/null 2>&1 || true
  done
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM
for cluster in source rehearsal; do
  mkdir -p "$PGROOT/$cluster/socket"
  initdb -D "$PGROOT/$cluster/data" -A trust --no-locale --encoding=UTF8 >/dev/null
  pg_ctl -D "$PGROOT/$cluster/data" -l "$PGROOT/$cluster/server.log" \
    -o "-k $PGROOT/$cluster/socket -p 5432 -c listen_addresses=''" start >/dev/null
done
# Clear the inherited environment entirely; all credentials below are synthetic.
env -i PATH="$PATH" HOME="$PGROOT" \
  PYTHONPATH="$ROOT/artifacts/api-server/backend:$ROOT/.pythonlibs/lib/python3.13/site-packages" \
  APP_ENV=production SESSION_SECRET=synthetic-fresh-install-tests-only-signing-key-not-a-live-credential \
  SUPER_ADMIN_INITIAL_PASSWORD=synthetic-fresh-install-password \
  STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}' \
  STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI= \
  DIRECTORY_ENCRYPTION_KEYS='{"primary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="}' \
  DIRECTORY_INDEX_KEY=RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU= \
  CORS_ORIGINS=https://fresh.allergyevexia.in \
  DATABASE_URL="postgresql+psycopg://$(id -un)@/fresh_install?host=$PGROOT/source/socket&port=5432" \
  FRESH_TEST_ROOT="$PGROOT" \
  python3 -B -m pytest -q -p no:cacheprovider \
    "$ROOT/artifacts/api-server/backend/tests/test_fresh_install.py" "$@"
