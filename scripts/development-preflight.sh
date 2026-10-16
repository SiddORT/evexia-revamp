#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PYTHONPATH="$ROOT/artifacts/api-server/backend${PYTHONPATH:+:$PYTHONPATH}"
if timeout -k 1s 9s python -B -m app.services.development_preflight; then
    exit 0
else
    status=$?
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
        printf '%s\n' '{"format":1,"ok":false,"checks":{"preflight":"timeout_or_unverified","running_api":"not_verified","ingress":"not_verified"}}'
    fi
    exit "$status"
fi
