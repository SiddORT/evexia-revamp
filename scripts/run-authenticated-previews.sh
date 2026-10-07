#!/bin/sh
# Run protected portal preview regressions against an isolated synthetic API.
# The private PostgreSQL instance uses a local socket only and is removed on exit.
set -eu
[ "${1:-}" != "--" ] || shift

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for tool in initdb pg_ctl createdb python3 curl node pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing authenticated-preview prerequisite: $tool" >&2; exit 1; }
done
if [ "${EVEXIA_NIX_DOWNLOAD_ENGINES:-}" = "1" ]; then
  case "$*" in
    ""|*download-logs.preview.spec.mjs*)
      (cd "$ROOT" && node scripts/prepare-nix-download-browsers.mjs) ;;
  esac
fi

# All runs use the same synthetic account and single-session policy. Fixed
# ports let concurrent checks accidentally share an API and revoke each other.
# Bind both candidates together to choose distinct free ports, also validating
# explicit overrides before creating a database or launching any services.
PORTS=$(python3 - <<'PY'
import os
import socket

with socket.socket() as api, socket.socket() as web:
    api.bind(("127.0.0.1", int(os.environ.get("EVEXIA_TEST_API_PORT") or 0)))
    web.bind(("127.0.0.1", int(os.environ.get("EVEXIA_TEST_PORT") or 0)))
    print(api.getsockname()[1], web.getsockname()[1])
PY
)
API_PORT=${PORTS% *}
PORT=${PORTS#* }

PGROOT=$(mktemp -d /tmp/evexia-auth-preview.XXXXXX)
chmod 700 "$PGROOT"
mkdir "$PGROOT/socket"
# Keep simultaneous task validations from clearing each other's diagnostics.
RESULTS="$ROOT/test-results/$(basename "$PGROOT")"
API_PID=
VITE_PID=
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    mkdir -p "$RESULTS/fixture-logs"
    for log in api vite postgres; do
      if [ -f "$PGROOT/$log.log" ]; then
        cp "$PGROOT/$log.log" "$RESULTS/fixture-logs/$log.log"
      fi
    done
    echo "Failed preview diagnostics: $RESULTS" >&2
  fi
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
export STAFF_ENCRYPTION_KEYS='{"primary":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="}'
export STAFF_ENCRYPTION_KEY_ID=primary
export STAFF_EMAIL_INDEX_KEY=QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
export JWT_SECRET=synthetic-isolated-preview-only-signing-key-145
export SESSION_SECRET=synthetic-isolated-preview-only-session-key-145
export SUPER_ADMIN_INITIAL_PASSWORD=Synthetic-preview-only-password-145
export CORS_ORIGINS=
export SCANNER_BACKEND=unavailable
export STORAGE_BACKEND=local
export LOCAL_STORAGE_ROOT="$PGROOT/storage"
export PYTHONPATH="$ROOT/artifacts/api-server/backend"

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
  if ! kill -0 "$API_PID" 2>/dev/null; then break; fi
  # curl alone may succeed against another process that won a bind race.
  if grep -q "Uvicorn running on http://127.0.0.1:$API_PORT " "$PGROOT/api.log" &&
    curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null; then ready=1; break; fi
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
  if ! kill -0 "$VITE_PID" 2>/dev/null; then break; fi
  if grep -q "http://localhost:$PORT/" "$PGROOT/vite.log" &&
    curl -fsS "$EVEXIA_PREVIEW_BASE_URL/" >/dev/null; then ready=1; break; fi
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
  SPECS="artifacts/evexia-portal/tests/entry-theme.preview.spec.mjs artifacts/evexia-portal/tests/settings-layout.preview.spec.mjs artifacts/evexia-portal/tests/template-preferences.preview.spec.mjs artifacts/evexia-portal/tests/communication.preview.spec.mjs artifacts/evexia-portal/tests/message-templates.preview.spec.mjs artifacts/evexia-portal/tests/admin-auth.preview.spec.mjs artifacts/evexia-portal/tests/roles-permissions.preview.spec.mjs artifacts/evexia-portal/tests/activity-logs.preview.spec.mjs artifacts/evexia-portal/tests/staff-backend.preview.spec.mjs artifacts/evexia-portal/tests/zones-backend.preview.spec.mjs artifacts/evexia-portal/tests/couriers-backend.preview.spec.mjs artifacts/evexia-portal/tests/locations-backend.preview.spec.mjs artifacts/evexia-portal/tests/designations-backend.preview.spec.mjs artifacts/evexia-portal/tests/courier-transfers.preview.spec.mjs"
fi
if [ "$#" -eq 0 ]; then
  SPECS="$SPECS artifacts/evexia-portal/tests/headquarters-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/product-categories-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/download-logs.preview.spec.mjs artifacts/evexia-portal/tests/staff-permissions.preview.spec.mjs"
fi
echo "Running authenticated browser previews against an isolated synthetic PostgreSQL/API fixture (API $API_PORT, portal $PORT)."
# Intentional word splitting: callers may supply one or more Playwright spec paths.
# Download regressions must run in all three engines, including on the default
# release path. Keep unrelated specs in their existing Chromium configuration.
# Run sequentially: concurrent projects would replace the synthetic session.
OTHER_SPECS=
DOWNLOADS=0
for spec in $SPECS; do
  case "$spec" in
    */download-logs.preview.spec.mjs) DOWNLOADS=1 ;;
    *) OTHER_SPECS="$OTHER_SPECS $spec" ;;
  esac
done
if [ -n "$OTHER_SPECS" ]; then
  # shellcheck disable=SC2086
  pnpm exec playwright test $OTHER_SPECS --workers=1 --output="$RESULTS/chromium-previews"
fi
if [ "$DOWNLOADS" -eq 1 ]; then
  echo "Download gate: Chromium, Firefox and WebKit (Safari engine, not native Safari). Missing engines are failures."
  pnpm exec playwright test --config=playwright.downloads.config.mjs --workers=1 --output="$RESULTS/download-matrix"
fi