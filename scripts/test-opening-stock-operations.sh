#!/bin/sh
# Explicit Opening Stock feature operations only, never a default/release suite.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" \
  tests/test_opening_stock_operations.py tests/test_opening_stock_concurrency.py
