#!/bin/sh
# Explicit staged production initialization. Never called by CI or startup.
# Requires the existing maintenance supervisor; see docs/fresh-install.md.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/artifacts/api-server/backend"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
exec "${EVEXIA_OPERATOR_PYTHON:-python3}" -B -m app.fresh_install "$@"