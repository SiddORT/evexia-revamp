#!/bin/sh
# PO-only authenticated smoke fixture. No managed data or broad release gates.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PGROOT=$(mktemp -d /tmp/evexia-po-smoke.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
API_PID= WEB_PID=
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    tail -n 50 "$PGROOT/api.log" "$PGROOT/web.log" 2>/dev/null || true
  fi
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
createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_po_smoke
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_po_smoke?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL" APP_ENV=test PORTAL_BOOTSTRAP_HOSTS= TRUSTED_PROXY_PEERS=
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export DIRECTORY_ENCRYPTION_KEYS='{"primary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M="}'
export DIRECTORY_ENCRYPTION_KEY_ID=primary DIRECTORY_INDEX_KEY=RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU=
export JWT_SECRET=synthetic-isolated-po-smoke-signing-key-not-a-live-credential
export SUPER_ADMIN_INITIAL_PASSWORD=Synthetic-po-smoke-only-password
export EVEXIA_TEST_ADMIN_PASSWORD="$SUPER_ADMIN_INITIAL_PASSWORD"
export SCANNER_BACKEND=unavailable STORAGE_BACKEND=local LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PASSWORD_RECOVERY_URL= SMTP_HOST= SMTP_USERNAME= SMTP_PASSWORD= SMTP_FROM=
export PYTHONPATH="$ROOT/artifacts/api-server/backend"
export EVEXIA_ISOLATED_AUTH_PREVIEW=1 EVEXIA_TEST_API_PROXY_TARGET="http://127.0.0.1:$API_PORT"
export EVEXIA_PREVIEW_BASE_URL="http://127.0.0.1:$PORT" PORT BASE_PATH=/
cd "$ROOT/artifacts/api-server/backend"
python3 -m alembic upgrade 0038_purchase_orders
python3 -m app.bootstrap
python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --no-access-log --no-proxy-headers >"$PGROOT/api.log" 2>&1 &
API_PID=$!
cd "$ROOT"
pnpm --filter @workspace/evexia-portal run dev >"$PGROOT/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "$EVEXIA_PREVIEW_BASE_URL/" >/dev/null 2>&1 &&
     curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health/readiness" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health/readiness" >/dev/null
pnpm exec playwright test --config=playwright.purchase-orders.config.mjs --workers=1 --retries=0 --output=generated-artifacts/po-smoke
