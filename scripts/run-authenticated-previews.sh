#!/bin/sh
# Run protected portal preview regressions against an isolated synthetic API.
# The private PostgreSQL instance uses a local socket only and is removed on exit.
set -eu
[ "${1:-}" != "--" ] || shift

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "${EVEXIA_ROLES_LAYOUT_ONLY:-}" = "1" ]; then
  if [ "$#" -ne 1 ] || [ "$1" != "artifacts/evexia-portal/tests/roles-permissions.preview.spec.mjs" ]; then
    echo "EVEXIA_ROLES_LAYOUT_ONLY is diagnostic-only and requires the single Roles and Permissions spec." >&2
    exit 1
  fi
fi
if [ "${EVEXIA_SALES_TARGET_LAYOUT_ONLY:-}" = "1" ]; then
  if [ "$#" -ne 1 ] || [ "$1" != "artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs" ]; then
    echo "EVEXIA_SALES_TARGET_LAYOUT_ONLY requires the single Sales Target spec." >&2
    exit 1
  fi
fi
for tool in initdb pg_ctl createdb python3 curl node pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing authenticated-preview prerequisite: $tool" >&2; exit 1; }
done
if [ "${EVEXIA_NIX_DOWNLOAD_ENGINES:-}" = "1" ]; then
  case "$*" in
    ""|*download-logs.preview.spec.mjs*|*patients-layout.preview.spec.mjs*|*roles-permissions.preview.spec.mjs*|*sales-targets-backend.preview.spec.mjs*)
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
export EVEXIA_ISOLATED_AUTH_PREVIEW=1
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
  SPECS="$SPECS artifacts/evexia-portal/tests/orders-navigation.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/headquarters-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/product-categories-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/allergens-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/master-listing-notices.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/opening-balances-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/doctors-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/patients-backend.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/patients-layout.preview.spec.mjs"
  SPECS="$SPECS artifacts/evexia-portal/tests/download-logs.preview.spec.mjs artifacts/evexia-portal/tests/staff-permissions.preview.spec.mjs artifacts/evexia-portal/tests/master-staff-permissions.preview.spec.mjs"
fi
echo "Running authenticated browser previews against an isolated synthetic PostgreSQL/API fixture (API $API_PORT, portal $PORT)."
# Intentional word splitting: callers may supply one or more Playwright spec paths.
# Download regressions must run in all three engines, including on the default
# release path. Keep unrelated specs in their existing Chromium configuration.
# Run sequentially: concurrent projects would replace the synthetic session.
OTHER_SPECS=
DOWNLOADS=0
PATIENT_LAYOUT=0
ROLE_LAYOUT=0
SALES_TARGET_LAYOUT=0
ISOLATE_MR=0
ISOLATE_SALES_TARGET=0
ISOLATE_OPENING_BALANCE=0
ISOLATE_MASTER_STAFF=0
ISOLATE_ORDERS=0
SPEC_COUNT=0
for spec in $SPECS; do
  case "$spec" in *.preview.spec.mjs) SPEC_COUNT=$((SPEC_COUNT + 1)) ;; esac
done
for spec in $SPECS; do
  case "$spec" in
    */download-logs.preview.spec.mjs) DOWNLOADS=1 ;;
    */patients-layout.preview.spec.mjs) PATIENT_LAYOUT=1 ;;
    */roles-permissions.preview.spec.mjs)
      ROLE_LAYOUT=1
      OTHER_SPECS="$OTHER_SPECS $spec" ;;
    */mrs-backend.preview.spec.mjs)
      # Doctor fixtures legitimately provision MR accounts too. Do not consume
      # the MR password-reset test's ten-per-hour actor budget with other suites,
      # disable production limits, or erase the protected credential audit.
      if [ "$SPEC_COUNT" -gt 1 ]; then ISOLATE_MR=1; else OTHER_SPECS="$OTHER_SPECS $spec"; fi ;;
    */sales-targets-backend.preview.spec.mjs)
      # Targets need real MR identities. Keep their credential-hashing actor
      # budget and reference rows out of other directory baseline suites.
      if [ "$SPEC_COUNT" -gt 1 ]; then ISOLATE_SALES_TARGET=1; else
        OTHER_SPECS="$OTHER_SPECS $spec"
        SALES_TARGET_LAYOUT=1
      fi ;;
    */opening-balances-backend.preview.spec.mjs)
      # This consuming workflow also legitimately creates MR-backed Doctors.
      # Preserve the real credential budget and history; do not combine its
      # seven reference-producing scenarios with the Doctor/Patient ledger.
      if [ "$SPEC_COUNT" -gt 1 ]; then ISOLATE_OPENING_BALANCE=1; else OTHER_SPECS="$OTHER_SPECS $spec"; fi ;;
    */master-staff-permissions.preview.spec.mjs)
      # Staff has no deletion workflow; disabling login cannot restore a fresh
      # directory. Keep matrix provisioning out of empty-directory baselines.
      if [ "$SPEC_COUNT" -gt 1 ]; then ISOLATE_MASTER_STAFF=1; else OTHER_SPECS="$OTHER_SPECS $spec"; fi ;;
    */orders-navigation.preview.spec.mjs)
      # Restricted navigation provisions staff with an assigned custom role.
      # Do not contaminate role deletion or empty staff-directory baselines.
      if [ "$SPEC_COUNT" -gt 1 ]; then ISOLATE_ORDERS=1; else OTHER_SPECS="$OTHER_SPECS $spec"; fi ;;
    *) OTHER_SPECS="$OTHER_SPECS $spec" ;;
  esac
done
if [ -n "$OTHER_SPECS" ] && [ "${EVEXIA_ROLES_LAYOUT_ONLY:-}" != "1" ] && [ "${EVEXIA_SALES_TARGET_LAYOUT_ONLY:-}" != "1" ]; then
  # shellcheck disable=SC2086
  pnpm exec playwright test $OTHER_SPECS --grep-invert='@roles-layout|@sales-target-layout' --workers=1 --output="$RESULTS/chromium-previews"
fi
if [ "$SALES_TARGET_LAYOUT" -eq 1 ]; then
  echo "Sales Target enlarged-text gate: Chromium, Firefox and WebKit (not native Safari). Missing engines are failures."
  pnpm exec playwright test --config=playwright.sales-targets.config.mjs --workers=1 --output="$RESULTS/sales-target-matrix"
fi
if [ "$ROLE_LAYOUT" -eq 1 ]; then
  echo "Roles and Permissions focused gate: Chromium, Firefox and WebKit (not native Safari). Missing engines are failures."
  pnpm exec playwright test --config=playwright.roles-permissions.config.mjs --workers=1 --output="$RESULTS/roles-permissions-matrix"
fi
if [ "$DOWNLOADS" -eq 1 ]; then
  echo "Download gate: Chromium, Firefox and WebKit (Safari engine, not native Safari). Missing engines are failures."
  pnpm exec playwright test --config=playwright.downloads.config.mjs --workers=1 --output="$RESULTS/download-matrix"
fi
if [ "$PATIENT_LAYOUT" -eq 1 ]; then
  echo "Patient enlarged-text gate: Chromium, Firefox and WebKit (Safari engine, not native Safari). Missing engines are failures."
  if [ "$#" -eq 0 ]; then
    # Reference setup legitimately provisions MR credentials. Keep its actor
    # budget separate from the larger Doctor/Patient baseline release suite.
    sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/patients-layout.preview.spec.mjs
  else
    pnpm exec playwright test --config=playwright.patients.config.mjs --workers=1 --output="$RESULTS/patient-layout-matrix"
  fi
fi
if [ "$ISOLATE_MR" -eq 1 ]; then
  echo "MR credential flows: separate private database, listeners and audit budget."
  sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs
fi
if [ "$ISOLATE_SALES_TARGET" -eq 1 ]; then
  echo "Sales Target flows: separate private database, listeners and MR credential budget."
  sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs
fi
if [ "$ISOLATE_OPENING_BALANCE" -eq 1 ]; then
  echo "Opening Balance reference fixtures: separate private database, listeners and credential audit budget."
  sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/opening-balances-backend.preview.spec.mjs
fi
if [ "$ISOLATE_MASTER_STAFF" -eq 1 ]; then
  echo "Staff master matrix: separate private database, listeners and directory."
  sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/master-staff-permissions.preview.spec.mjs
fi
if [ "$ISOLATE_ORDERS" -eq 1 ]; then
  echo "Orders navigation: separate private database, staff directory and role assignments."
  sh "$ROOT/scripts/run-authenticated-previews.sh" artifacts/evexia-portal/tests/orders-navigation.preview.spec.mjs
fi