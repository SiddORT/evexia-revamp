#!/bin/sh
# Source from a harness that has already set ROOT. Arguments remain separate;
# labels contain no credentials, connection strings, or synthetic passwords.
timed() {
  label=$1
  shift
  if [ -n "${EVEXIA_RELEASE_PROFILE:-}" ]; then
    python3 "$ROOT/scripts/profile-release-command.py" \
      --output "$EVEXIA_RELEASE_PROFILE" --label "$label" -- "$@"
  else
    "$@"
  fi
}
