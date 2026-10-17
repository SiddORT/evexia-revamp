#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
. "$ROOT/scripts/release-timing.sh"
# Each release owns its cache. Never inherit another run's writable state, and
# never persist PostgreSQL snapshots in CI's dependency-download cache.
EVEXIA_TEST_CACHE_ROOT=$(mktemp -d /tmp/evexia-release-cache.XXXXXX)
export EVEXIA_TEST_CACHE_ROOT
export EVEXIA_RELEASE_PROFILE="${EVEXIA_RELEASE_PROFILE:-$ROOT/test-results/$(basename "$EVEXIA_TEST_CACHE_ROOT")/timing.jsonl}"
cleanup_release() { rm -rf "$EVEXIA_TEST_CACHE_ROOT"; }
trap cleanup_release EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
run() { timed "gate:$*" "$@"; }
echo "Release timing evidence: $EVEXIA_RELEASE_PROFILE"

# Preserve every service/backend/migration/security/browser command and its
# order. A failed command still stops the entire gate immediately.
run pnpm run test:development-gate
run pnpm --filter @workspace/evexia-portal run test:admin-session
run pnpm --filter @workspace/evexia-portal run test:date-preferences
run pnpm --filter @workspace/evexia-portal run test:doctor-demo
run node --test artifacts/evexia-portal/src/services/passwordRecovery.test.js
run sh scripts/test-api-foundation.sh tests/test_password_recovery.py tests/test_development_gate.py
run node --test artifacts/evexia-portal/src/config/portalHost.test.js
run node --test artifacts/evexia-portal/src/config/portalResolver.test.js
run node --test scripts/check-portal-hostname.test.mjs
run python -B -m unittest discover -s scripts/tests -p 'test_operator_hostnames.py'
run sh scripts/test-api-foundation.sh tests/test_role_urls.py tests/test_domain_admission.py tests/test_migration_domain_admission.py tests/test_nginx_domain_admission.py tests/test_proxy_client_identity.py tests/test_operator_hostnames.py
run node --test artifacts/evexia-portal/src/services/phoneCountries.test.js
run sh scripts/test-api-foundation.sh tests/test_shared_phone.py tests/test_shared_phone_migration.py
run pnpm --filter @workspace/evexia-portal run test:spt-orders
run pnpm --filter @workspace/evexia-portal run test:kits-orders
run pnpm --filter @workspace/evexia-portal run test:immunotherapy
run node --test artifacts/evexia-portal/src/auth/staffPermissions.test.js artifacts/evexia-portal/src/auth/navigationGuard.test.js
run pnpm --filter @workspace/evexia-portal run test:template-preferences:service
run node --test artifacts/evexia-portal/src/services/rolePermissions.test.js
run node --test artifacts/evexia-portal/src/services/reportingCSV.test.js
run node --test artifacts/evexia-portal/src/services/downloads.test.js
run node --test artifacts/evexia-portal/src/services/staff.test.js
run sh scripts/test-api-foundation.sh tests/test_staff.py tests/test_staff_search.py tests/test_staff_rotation.py tests/test_migration_staff.py tests/test_staff_lifecycle.py tests/test_migration_staff_designation.py
run sh scripts/test-api-foundation.sh tests/test_directory_crypto.py tests/test_directory_staging.py tests/test_directory_retirement.py tests/test_directory_runtime.py tests/test_directory_rotation.py
run sh scripts/test-api-foundation.sh tests/test_account_crypto.py
run node --test artifacts/evexia-portal/src/services/serverHeadquarters.test.js
run node --test artifacts/evexia-portal/src/services/serverProductCategories.test.js artifacts/evexia-portal/src/services/productCategories.test.js
run node --test artifacts/evexia-portal/src/services/serverAllergens.test.js artifacts/evexia-portal/src/services/allergens.test.js
run sh scripts/test-api-foundation.sh tests/test_allergens.py tests/test_migration_allergens.py
run sh scripts/test-api-foundation.sh tests/test_product_categories.py tests/test_product_category_files.py tests/test_migration_product_categories.py
run node --test artifacts/evexia-portal/src/services/serverMRs.test.js
run node --test artifacts/evexia-portal/src/services/mrWorkspaceDemo.test.js
run sh scripts/test-api-foundation.sh tests/test_mrs.py tests/test_migration_mrs.py tests/test_migration_mr_designation.py
run node --test artifacts/evexia-portal/src/services/serverDoctors.test.js
run node --test artifacts/evexia-portal/src/services/serverOpeningBalances.test.js
run sh scripts/test-api-foundation.sh tests/test_opening_balances.py tests/test_migration_opening_balances.py tests/test_master_import_request_limits.py
run sh scripts/test-api-foundation.sh tests/test_doctors.py tests/test_migration_doctors.py tests/test_directory_deletion.py tests/test_migration_directory_deletion.py
run node --test artifacts/evexia-portal/src/services/serverPatients.test.js
run sh scripts/test-api-foundation.sh tests/test_patients.py tests/test_migration_patients.py tests/test_patient_files.py tests/test_patient_scale.py
run sh scripts/test-api-foundation.sh tests/test_headquarters.py tests/test_migration_headquarters.py
run sh scripts/test-api-foundation.sh tests/test_roles.py tests/test_role_lifecycle.py tests/test_migration_roles.py tests/test_migration_role_lifecycle.py tests/test_zone_permissions.py tests/test_master_permissions.py tests/test_migration_master_permissions.py tests/test_migration_zone_permissions.py tests/test_locations.py tests/test_migration_locations.py tests/test_designations.py tests/test_migration_designations.py tests/test_downloads.py tests/test_download_queries.py tests/test_download_files.py
run node --test artifacts/evexia-portal/src/services/serverCouriers.test.js
run node --test artifacts/evexia-portal/src/services/serverLocations.test.js
run node --test artifacts/evexia-portal/src/services/serverDesignations.test.js artifacts/evexia-portal/src/services/serverDesignationValidation.test.js
run node --test artifacts/evexia-portal/src/services/serverVendors.test.js artifacts/evexia-portal/src/services/vendors.test.js
run sh scripts/test-api-foundation.sh tests/test_vendors.py tests/test_migration_vendors.py
run node --test artifacts/evexia-portal/src/services/serverSalesTargets.test.js artifacts/evexia-portal/src/services/salesTargets.test.js
run sh scripts/test-api-foundation.sh tests/test_sales_targets.py tests/test_migration_sales_targets.py tests/test_sales_target_performance.py tests/test_migration_designation_target_schema.py
run python3 -B scripts/test-fixture-cache-isolation.py
run sh scripts/run-authenticated-previews.sh
run sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/password-recovery.preview.spec.mjs
EVEXIA_TEST_DEVELOPMENT_GATE=1 run sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/development-gate.preview.spec.mjs
run sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/date-preferences.preview.spec.mjs
