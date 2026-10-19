#!/bin/sh
# Only the named changed inventory and directly affected receipt CRUD tests.
# The underlying runner creates a fresh private-socket synthetic PostgreSQL.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PR_ENCRYPTION_KEYS='{"primary":"R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0c="}'
export PR_ENCRYPTION_KEY_ID=primary
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" tests/test_inventory_crud.py tests/test_purchase_received_crud.py
