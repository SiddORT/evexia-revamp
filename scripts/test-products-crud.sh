#!/bin/sh
# Explicit changed-resource CRUD tests only; never a release/default/browser suite.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" tests/test_products_crud.py tests/test_inventory_crud.py tests/test_purchase_received_crud.py tests/test_products_concurrency.py
