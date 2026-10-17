#!/bin/sh
# Empty-only production initialization; legacy staged commands remain explicit.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/artifacts/api-server/backend"
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
case "${1:-}" in
  prepare|finalize) MODULE=app.fresh_install ;;
  *) MODULE=app.initialize_database ;;
esac
exec "${EVEXIA_OPERATOR_PYTHON:-python3}" -B -m "$MODULE" "$@"