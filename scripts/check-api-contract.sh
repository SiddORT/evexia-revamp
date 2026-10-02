#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMP_FILE=$(mktemp)
trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM

cd "$ROOT"
python3 scripts/export-api-contract.py --output "$TEMP_FILE"
if ! cmp -s lib/api-spec/openapi.yaml "$TEMP_FILE"; then
  echo "API contract is stale. Run: python3 scripts/export-api-contract.py" >&2
  diff -u lib/api-spec/openapi.yaml "$TEMP_FILE" || true
  exit 1
fi
echo "API contract is up to date."