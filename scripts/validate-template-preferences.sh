#!/bin/sh
set -eu

# Run auth and preference service checks, then the complete authenticated
# preview suite once against isolated PostgreSQL/API/Vite and fresh contexts.
pnpm --filter @workspace/evexia-portal run test:admin-session
pnpm --filter @workspace/evexia-portal run test:template-preferences:service
sh scripts/run-authenticated-previews.sh