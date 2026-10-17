#!/bin/sh
# Frontend-only focused Role URLs layout regression. All browser API traffic is
# intercepted in the spec; Vite's API proxy points at an intentionally closed port.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS="$ROOT/test-results/role-urls-layout/run-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$RESULTS"
PORT=$(python3 - <<'PY'
import socket
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    print(s.getsockname()[1])
PY
)
export PORT APP_ENV=test
export EVEXIA_TEST_API_PROXY_TARGET=http://127.0.0.1:1
export EVEXIA_PREVIEW_BASE_URL="http://127.0.0.1:$PORT"
export EVEXIA_ROLE_URL_LAYOUT_PREVIEW=1
: "${EVEXIA_NIX_DOWNLOAD_ENGINES:=1}"
export EVEXIA_NIX_DOWNLOAD_ENGINES

for tool in python3 curl node pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing focused layout prerequisite: $tool" >&2; exit 1; }
done
if [ -z "${EVEXIA_CHROMIUM_PATH:-}" ]; then
  EVEXIA_CHROMIUM_PATH=$(command -v chromium || command -v chromium-browser || true)
  export EVEXIA_CHROMIUM_PATH
fi

if [ "$EVEXIA_NIX_DOWNLOAD_ENGINES" = "1" ]; then
  (cd "$ROOT" && node scripts/prepare-nix-download-browsers.mjs)
fi

VITE_PID=
cleanup() {
  result=$?
  if [ -n "$VITE_PID" ]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  echo "Role URLs focused-run artifacts: $RESULTS"
  exit "$result"
}
trap cleanup EXIT HUP INT TERM

cd "$ROOT"
(
  cd "$ROOT/artifacts/evexia-portal"
  exec node node_modules/vite/bin/vite.js --config vite.config.js --host 127.0.0.1
) >"$RESULTS/vite.log" 2>&1 &
VITE_PID=$!
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then break; fi
  if grep -q "http://127.0.0.1:$PORT/" "$RESULTS/vite.log" &&
    curl -fsS "$EVEXIA_PREVIEW_BASE_URL/" >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Focused Vite preview did not become ready; see $RESULTS/vite.log" >&2
  exit 1
fi

status=0
PLAYWRIGHT_JSON_OUTPUT_NAME="$RESULTS/results.json" \
  pnpm exec playwright test --config=playwright.role-urls-layout.config.mjs \
  --workers=1 --output="$RESULTS/artifacts" --reporter=list,json \
  >"$RESULTS/playwright.log" 2>&1 || status=$?
cat "$RESULTS/playwright.log"
exit "$status"
