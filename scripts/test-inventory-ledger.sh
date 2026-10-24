#!/bin/sh
# Named new ledger/adjustment checks only; private socket synthetic PostgreSQL.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" tests/test_inventory_ledger.py
