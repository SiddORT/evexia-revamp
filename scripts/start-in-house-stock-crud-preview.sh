#!/bin/sh
# In-house reserve CRUD/responsiveness fixture only. No release/regression suites.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PGROOT=$(mktemp -d /tmp/evexia-in-house-crud.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
API_PID= WEB_PID=
cleanup() {
  [ -z "$WEB_PID" ] || kill "$WEB_PID" 2>/dev/null || true
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true
  pg_ctl -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM
PORTS=$(python3 - <<'PY'
import socket
with socket.socket() as a, socket.socket() as b:
    a.bind(("127.0.0.1", 0)); b.bind(("127.0.0.1", 0))
    print(a.getsockname()[1], b.getsockname()[1])
PY
)
API_PORT=${PORTS% *}
PORT=${PORTS#* }
initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$PGROOT/data" -l "$PGROOT/postgres.log" -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_in_house_test
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_in_house_test?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL" APP_ENV=test PORTAL_BOOTSTRAP_HOSTS= TRUSTED_PROXY_PEERS=
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export DIRECTORY_ENCRYPTION_KEYS='{"primary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="}'
export DIRECTORY_ENCRYPTION_KEY_ID=primary DIRECTORY_INDEX_KEY=RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU=
export COMMUNICATION_ENCRYPTION_KEYS='{"primary":"RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY="}'
export COMMUNICATION_ENCRYPTION_KEY_ID=primary
export PR_ENCRYPTION_KEYS='{"primary":"R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0c="}' PR_ENCRYPTION_KEY_ID=primary
export JWT_SECRET=synthetic-isolated-in-house-signing-key-not-live
export SESSION_SECRET=synthetic-isolated-in-house-session-key-not-live
export SUPER_ADMIN_INITIAL_PASSWORD=Synthetic-in-house-only-password
export SUPER_ADMIN_EMAIL=crm-admin@allergyevexia.in
export SCANNER_BACKEND=unavailable STORAGE_BACKEND=local LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PASSWORD_RECOVERY_URL= SMTP_HOST= SMTP_USERNAME= SMTP_PASSWORD= SMTP_FROM=
export PYTHONPATH="$ROOT/artifacts/api-server/backend"
export EVEXIA_ISOLATED_AUTH_PREVIEW=1 EVEXIA_TEST_API_PROXY_TARGET="http://127.0.0.1:$API_PORT"
export PORT BASE_PATH=/
cd "$ROOT/artifacts/api-server/backend"
python3 -B -m alembic upgrade head
if [ "${1:-}" = "--api-crud" ]; then
  # Named new-feature cases only, not the release or default regression runner.
  python3 -B -m pytest -q tests/test_in_house_stock.py::test_create_history_isolation_dedup_search_and_reconcile \
    tests/test_in_house_stock.py::test_invalid_fields_rejected_before_persistence \
    tests/test_in_house_stock.py::test_cancelled_request_stale_review_active_references_authorization
  exit $?
fi
python3 -B -m app.bootstrap
python3 -B -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --no-access-log --no-proxy-headers >"$PGROOT/api.log" 2>&1 &
API_PID=$!
cd "$ROOT/artifacts/evexia-portal"
pnpm exec vite --config vite.config.js --host 127.0.0.1 >"$PGROOT/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &&
     curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1; then
    echo "IN_HOUSE_CRUD_READY http://127.0.0.1:$PORT"
    echo "Private synthetic fixture logs: $PGROOT"
    wait "$API_PID"
    exit $?
  fi
  sleep 1
done
tail -n 30 "$PGROOT/api.log" "$PGROOT/web.log"
exit 1
