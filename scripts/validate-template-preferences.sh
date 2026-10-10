#!/bin/sh
set -eu

# Run auth and preference service checks, then the complete authenticated
# preview suite once against isolated PostgreSQL/API/Vite and fresh contexts.
pnpm --filter @workspace/evexia-portal run test:admin-session
pnpm --filter @workspace/evexia-portal run test:spt-orders
pnpm --filter @workspace/evexia-portal run test:immunotherapy
node --test artifacts/evexia-portal/src/auth/staffPermissions.test.js artifacts/evexia-portal/src/auth/navigationGuard.test.js
pnpm --filter @workspace/evexia-portal run test:template-preferences:service
node --test artifacts/evexia-portal/src/services/rolePermissions.test.js
node --test artifacts/evexia-portal/src/services/reportingCSV.test.js
node --test artifacts/evexia-portal/src/services/downloads.test.js
node --test artifacts/evexia-portal/src/services/staff.test.js
sh scripts/test-api-foundation.sh tests/test_staff.py tests/test_staff_search.py tests/test_staff_rotation.py tests/test_migration_staff.py tests/test_staff_lifecycle.py tests/test_migration_staff_designation.py
sh scripts/test-api-foundation.sh tests/test_directory_crypto.py tests/test_directory_staging.py tests/test_directory_retirement.py tests/test_directory_runtime.py tests/test_directory_rotation.py
node --test artifacts/evexia-portal/src/services/serverHeadquarters.test.js
node --test artifacts/evexia-portal/src/services/serverProductCategories.test.js artifacts/evexia-portal/src/services/productCategories.test.js
node --test artifacts/evexia-portal/src/services/serverAllergens.test.js artifacts/evexia-portal/src/services/allergens.test.js
sh scripts/test-api-foundation.sh tests/test_allergens.py tests/test_migration_allergens.py
sh scripts/test-api-foundation.sh tests/test_product_categories.py tests/test_product_category_files.py tests/test_migration_product_categories.py
node --test artifacts/evexia-portal/src/services/serverMRs.test.js
sh scripts/test-api-foundation.sh tests/test_mrs.py tests/test_migration_mrs.py tests/test_migration_mr_designation.py
node --test artifacts/evexia-portal/src/services/serverDoctors.test.js
node --test artifacts/evexia-portal/src/services/serverOpeningBalances.test.js
sh scripts/test-api-foundation.sh tests/test_opening_balances.py tests/test_migration_opening_balances.py tests/test_master_import_request_limits.py
sh scripts/test-api-foundation.sh tests/test_doctors.py tests/test_migration_doctors.py tests/test_directory_deletion.py tests/test_migration_directory_deletion.py
node --test artifacts/evexia-portal/src/services/serverPatients.test.js
sh scripts/test-api-foundation.sh tests/test_patients.py tests/test_migration_patients.py tests/test_patient_files.py tests/test_patient_scale.py
sh scripts/test-api-foundation.sh tests/test_headquarters.py tests/test_migration_headquarters.py
sh scripts/test-api-foundation.sh tests/test_roles.py tests/test_role_lifecycle.py tests/test_migration_roles.py tests/test_migration_role_lifecycle.py tests/test_zone_permissions.py tests/test_master_permissions.py tests/test_migration_master_permissions.py tests/test_migration_zone_permissions.py tests/test_locations.py tests/test_migration_locations.py tests/test_designations.py tests/test_migration_designations.py tests/test_downloads.py tests/test_download_queries.py tests/test_download_files.py
node --test artifacts/evexia-portal/src/services/serverCouriers.test.js
node --test artifacts/evexia-portal/src/services/serverLocations.test.js
node --test artifacts/evexia-portal/src/services/serverDesignations.test.js artifacts/evexia-portal/src/services/serverDesignationValidation.test.js
node --test artifacts/evexia-portal/src/services/serverVendors.test.js artifacts/evexia-portal/src/services/vendors.test.js
sh scripts/test-api-foundation.sh tests/test_vendors.py tests/test_migration_vendors.py
node --test artifacts/evexia-portal/src/services/serverSalesTargets.test.js artifacts/evexia-portal/src/services/salesTargets.test.js
sh scripts/test-api-foundation.sh tests/test_sales_targets.py tests/test_migration_sales_targets.py tests/test_sales_target_performance.py tests/test_migration_designation_target_schema.py
sh scripts/run-authenticated-previews.sh