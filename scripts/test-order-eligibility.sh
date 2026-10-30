#!/bin/sh
# Manual-only. No release workflow, application restart or production access.
set -eu
if [ "${1:-}" != "--approved-disposable-checks" ]; then
  echo "Separate user approval is required. Then pass --approved-disposable-checks." >&2
  exit 2
fi
shift
export EVEXIA_ELIGIBILITY_DISPOSABLE=approved-private-fixture
# This existing harness overrides DB URLs/keys, creates a private socket-only
# cluster, migrates only that disposable DB, and destroys it on exit.
unset EVEXIA_TEST_CACHE_ROOT
sh "$(dirname "$0")/test-api-foundation.sh" \
  tests/test_order_eligibility.py tests/test_order_eligibility_concurrency.py "$@"
