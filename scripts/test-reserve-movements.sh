#!/bin/sh
# New-feature transactions only; no release/default/regression suites.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" tests/test_reserve_movements.py
