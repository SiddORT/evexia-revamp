#!/bin/sh
# Normal development access never runs compatibility or ingress diagnostics.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/artifacts/evexia-portal"
exec pnpm exec vite --config vite.config.js --host 0.0.0.0
