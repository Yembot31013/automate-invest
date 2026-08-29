#!/usr/bin/env bash
# Fix loopback hostnames so browsers can reach the local Next server reliably.
# Run: bash scripts/fix-local-hosts.sh
set -euo pipefail

HOSTS_FILE="/etc/hosts"
MARKER="# signal-desk local"
BLOCK_FILE="$(mktemp)"

cat >"$BLOCK_FILE" <<'EOF'
# signal-desk local
127.0.0.1 localhost
::1 localhost
127.0.0.1 signaldesk.local
::1 signaldesk.local
EOF

if ! grep -q "$MARKER" "$HOSTS_FILE" 2>/dev/null; then
  echo "Adding Signal Desk loopback entries to $HOSTS_FILE (needs sudo)..."
  # shellcheck disable=SC2024
  sudo sh -c "printf '\n' >>'$HOSTS_FILE' && cat '$BLOCK_FILE' >>'$HOSTS_FILE'"
  echo "Hosts updated."
else
  echo "Signal Desk hosts entries already present."
fi

rm -f "$BLOCK_FILE"

echo
echo "Verify:"
getent hosts localhost || true
getent hosts signaldesk.local || true
echo
echo "Use one of these in Chrome (and in Clerk Dashboard → allowed origins):"
echo "  http://127.0.0.1:3000"
echo "  http://localhost:3000"
echo "  http://signaldesk.local:3000"
echo
echo "If localhost still fails in Chrome only:"
echo "  chrome://settings/security → Secure DNS → Off"
echo "  chrome://settings/system → Open proxy settings → ensure no proxy for localhost"
echo "  Clear site data for localhost / 127.0.0.1"
