#!/bin/sh
# Run protected portal preview regressions against an isolated synthetic API.
# The private PostgreSQL instance uses a local socket only and is removed on exit.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for tool in initdb pg_ctl createdb python3 curl node pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing authenticated-preview prerequisite: $tool" >&2; exit 1; }
done

PGROOT=$(mktemp -d /tmp/evexia-auth-preview.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
API_PID=
VITE_PID=
cleanup() {
  if [ -n "$VITE_PID" ]; then kill "$VITE_PID" >/dev/null 2>&1 || true; wait "$VITE_PID" 2>/dev/null || true; fi
  if [ -n "$API_PID" ]; then kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" 2>/dev/null || true; fi
  pg_ctl -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGROOT"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$PGROOT/data" -A trust --no-locale --encoding=UTF8 >/dev/null
# No TCP listener: trust authentication is limited to this private test socket.
pg_ctl -D "$PGROOT/data" -l "$PGROOT/postgres.log" \
  -o "-k $PGROOT/socket -p 5432 -c listen_addresses=''" start >/dev/null
createdb -h "$PGROOT/socket" -p 5432 -U "$(id -un)" evexia_auth_preview_test

# Replace any ambient DB/auth settings so this fixture cannot reach a configured database.
export DATABASE_URL="postgresql+psycopg://$(id -un)@/evexia_auth_preview_test?host=$PGROOT/socket&port=5432"
export TEST_DATABASE_URL="$DATABASE_URL"
export APP_ENV=test
export JWT_SECRET=synthetic-isolated-preview-only-signing-key-145
export SESSION_SECRET=synthetic-isolated-preview-only-session-key-145
export SUPER_ADMIN_INITIAL_PASSWORD=Synthetic-preview-only-password-145
export CORS_ORIGINS=
export SCANNER_BACKEND=unavailable
export STORAGE_BACKEND=local
export LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PYTHONPATH="$ROOT/artifacts/api-server/backend"

API_PORT=${EVEXIA_TEST_API_PORT:-8187}
PORT=${EVEXIA_TEST_PORT:-5187}
export EVEXIA_TEST_ADMIN_PASSWORD="$SUPER_ADMIN_INITIAL_PASSWORD"
export EVEXIA_PREVIEW_BASE_URL="http://127.0.0.1:$PORT"
export EVEXIA_TEST_API_PROXY_TARGET="http://127.0.0.1:$API_PORT"

sh "$ROOT/scripts/initialize-api.sh"
cd "$ROOT/artifacts/api-server/backend"
python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --no-access-log \
  >"$PGROOT/api.log" 2>&1 &
API_PID=$!

ready=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null; then ready=1; break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Isolated API did not become ready; startup details follow (synthetic test environment only):" >&2
  tail -n 80 "$PGROOT/api.log" >&2 || true
  exit 1
fi

cd "$ROOT"
PORT="$PORT" pnpm --filter @workspace/evexia-portal run dev >"$PGROOT/vite.log" 2>&1 &
VITE_PID=$!
ready=0
for _ in $(seq 1 60); do
  if curl -fsS "$EVEXIA_PREVIEW_BASE_URL/" >/dev/null; then ready=1; break; fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Isolated portal preview did not become ready; startup details follow:" >&2
  tail -n 80 "$PGROOT/vite.log" >&2 || true
  exit 1
fi
if ! curl -fsS "$EVEXIA_PREVIEW_BASE_URL/api/healthz" >/dev/null; then
  echo "The portal's same-origin /api proxy did not reach the isolated API." >&2
  tail -n 80 "$PGROOT/vite.log" >&2 || true
  exit 1
fi

if [ -z "${EVEXIA_CHROMIUM_PATH:-}" ]; then
  EVEXIA_CHROMIUM_PATH=$(command -v chromium || command -v chromium-browser || true)
fi
export EVEXIA_CHROMIUM_PATH

if [ "$#" -gt 0 ]; then
  SPECS="$*"
else
  SPECS="artifacts/evexia-portal/tests/template-preferences.preview.spec.mjs artifacts/evexia-portal/tests/communication.preview.spec.mjs artifacts/evexia-portal/tests/message-templates.preview.spec.mjs artifacts/evexia-portal/tests/admin-auth.preview.spec.mjs"
fi
echo "Running authenticated browser previews against an isolated synthetic PostgreSQL/API fixture."
# Intentional word splitting: callers may supply one or more Playwright spec paths.
# shellcheck disable=SC2086
pnpm exec playwright test $SPECS --workers=1