#!/usr/bin/env bash
# Replit-only service. Never publish the ClamAV TCP port or the runtime files.
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE="$ROOT/.local/clamav"
umask 077
mkdir -p "$STATE/database"
if [[ -L "$STATE" || -L "$STATE/database" ]] ||
   [[ "$(stat -c '%u:%a' "$STATE")" != "$(id -u):700" ]] ||
   [[ "$(stat -c '%u:%a' "$STATE/database")" != "$(id -u):700" ]]; then
  echo "Private scanner directories must be owned by this user with mode 0700." >&2
  exit 1
fi
exec 9>"$STATE/supervisor.lock"
flock -n 9 || { echo "Development scanner already supervised." >&2; exit 1; }
# Write only regular, private configuration files inside the restricted directory.
for config in freshclam.conf clamd.conf; do
  if [[ -L "$STATE/$config" || ( -e "$STATE/$config" && ! -f "$STATE/$config" ) ]]; then
    echo "Unsafe scanner configuration path." >&2
    exit 1
  fi
done
cat >"$STATE/freshclam.conf" <<EOF
DatabaseDirectory $STATE/database
DatabaseOwner $(id -un)
DatabaseMirror database.clamav.net
ConnectTimeout 10
ReceiveTimeout 60
MaxAttempts 2
Checks 12
NotifyClamd $STATE/clamd.conf
EOF
cat >"$STATE/clamd.conf" <<EOF
DatabaseDirectory $STATE/database
TCPSocket 3310
TCPAddr 127.0.0.1
Foreground yes
LogTime yes
SelfCheck 600
MaxThreads 2
MaxQueue 8
StreamMaxLength 20M
MaxFileSize 20M
MaxScanSize 100M
MaxScanTime 10000
AlertExceedsMax yes
FailIfCvdOlderThan 7
EOF
# freshclam validates the publisher's signed databases. Failure blocks startup;
# do not substitute custom signatures, an empty database or a fake clean scanner.
freshclam --config-file="$STATE/freshclam.conf" --stdout
children=()
cleanup() {
  trap - EXIT
  if ((${#children[@]})); then
    kill -TERM "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
clamd --config-file="$STATE/clamd.conf" --foreground &
children+=("$!")
freshclam --config-file="$STATE/freshclam.conf" --daemon --foreground --stdout &
children+=("$!")
# Stop both if either exits; an updater failure must not be silently ignored.
wait -n "${children[@]}" || true
echo "Development scanner or signature updater stopped; restart this workflow." >&2
exit 1
