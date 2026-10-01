#!/bin/sh
set -eu

# The browser spec imports Vite source modules, so use a running dev preview,
# not a static build. Never start a browser with a user's persistent profile.
if [ -z "${EVEXIA_PREVIEW_BASE_URL:-}" ]; then
  if [ -z "${REPLIT_DEV_DOMAIN:-}" ]; then
    echo "Release blocked: set EVEXIA_PREVIEW_BASE_URL to the running EVEXIA dev preview URL." >&2
    exit 1
  fi
  EVEXIA_PREVIEW_BASE_URL="https://${REPLIT_DEV_DOMAIN}"
fi
export EVEXIA_PREVIEW_BASE_URL

# Prefer an explicitly configured executable; otherwise use system Chromium
# when available, or let Playwright use its installed Chromium binary.
if [ -z "${EVEXIA_CHROMIUM_PATH:-}" ]; then
  EVEXIA_CHROMIUM_PATH="$(command -v chromium || command -v chromium-browser || true)"
fi
export EVEXIA_CHROMIUM_PATH

pnpm run test:template-preferences