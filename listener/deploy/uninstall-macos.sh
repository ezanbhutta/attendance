#!/usr/bin/env bash
#
# Remove the macOS background service installed by deploy/install-macos.sh.
# The catcher will no longer auto-start; you can still run it with `npm start`.
#
set -euo pipefail

LABEL="com.attendance.catcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "✅ Removed LaunchAgent: $LABEL (the catcher will no longer auto-start)."
echo "   Run it manually any time with:  npm start"
