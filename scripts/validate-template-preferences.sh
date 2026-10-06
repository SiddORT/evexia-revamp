#!/bin/sh
set -eu

# Run auth and preference service checks, then the complete authenticated
# preview suite once against isolated PostgreSQL/API/Vite and fresh contexts.
pnpm --filter @workspace/evexia-portal run test:admin-session
pnpm --filter @workspace/evexia-portal run test:template-preferences:service
node --test artifacts/evexia-portal/src/services/rolePermissions.test.js
node --test artifacts/evexia-portal/src/services/reportingCSV.test.js
sh scripts/run-authenticated-previews.sh