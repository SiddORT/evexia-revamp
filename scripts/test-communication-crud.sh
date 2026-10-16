#!/bin/sh
# Only Communication CRUD tests; private disposable PostgreSQL, no shared services.
set -eu
export COMMUNICATION_ENCRYPTION_KEYS='{"primary":"RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY="}'
export COMMUNICATION_ENCRYPTION_KEY_ID=primary
sh "$(dirname "$0")/test-api-foundation.sh" tests/test_communication.py
node --test artifacts/evexia-portal/src/services/communicationSettings.test.js
node --test artifacts/evexia-portal/tests/communication-form.test.mjs
