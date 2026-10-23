#!/bin/sh
# Explicitly authorized Staff number coverage; synthetic private PostgreSQL only.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
exec sh "$ROOT/scripts/test-api-foundation.sh" \
  tests/test_migration_staff_account_numbers.py tests/test_staff_account_numbers.py "$@"
