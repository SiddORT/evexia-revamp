#!/bin/sh
# One startup pipeline, not a timer/browser quarantine. Preserve mounted drafts.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/artifacts/evexia-portal"
if [ -z "${REPLIT_DEV_DOMAIN:-}" ] || [ "${EVEXIA_ISOLATED_AUTH_PREVIEW:-}" = 1 ]; then
  exec pnpm exec vite --config vite.config.js --host 0.0.0.0
fi
pnpm exec vite --config vite.config.js --host 0.0.0.0 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT HUP INT TERM
READY=no
for ATTEMPT in $(seq 1 30); do
  kill -0 "$SERVER" 2>/dev/null || exit 1
  if python -B "$ROOT/scripts/verify-running-release.py" --development \
    --frontend "https://$REPLIT_DEV_DOMAIN"; then READY=yes; break; fi
  sleep 2
done
if [ "$READY" != yes ]; then
  echo "DEVELOPMENT_START_BLOCKED: live backend/frontend/schema do not match; no readiness claimed" >&2
  exit 1
fi
echo "DEVELOPMENT_RUNNING_RELEASE_VERIFIED"
wait "$SERVER"
