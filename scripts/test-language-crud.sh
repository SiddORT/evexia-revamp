#!/bin/sh
# Focused Language CRUD only, using an ephemeral private-socket PostgreSQL.
# No release/regression checks, shared target sync, browser matrix or build.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset EVEXIA_TEST_CACHE_ROOT
sh "$ROOT/scripts/test-api-foundation.sh" tests/test_languages_crud.py
node --test "$ROOT/artifacts/evexia-portal/src/services/serverLanguages.test.js"
