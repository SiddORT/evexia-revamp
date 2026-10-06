#!/bin/sh
# Private, disposable PostgreSQL; never inherit an application database URL.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PGROOT=$(mktemp -d /tmp/evexia-report-profile.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
cleanup() {
  pg_ctl -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$PGROOT/data" -l "$PGROOT/server.log" \
  -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
createdb -h "$PGROOT/socket" -U "$(id -un)" evexia_reporting_test
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_reporting_test?host=$PGROOT/socket"
export APP_ENV=test
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
cd "$ROOT/artifacts/api-server/backend"
python3 -m alembic upgrade head
python3 "$ROOT/scripts/profile_activity_search.py" "$@"
