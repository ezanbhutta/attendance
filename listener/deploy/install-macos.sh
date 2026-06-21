#!/usr/bin/env bash
#
# Install the ADMS listener as a macOS background service (launchd LaunchAgent).
# This is the macOS counterpart to deploy/attendance-listener.service (systemd)
# and ecosystem.config.js (pm2): it starts the catcher automatically at login
# and restarts it within seconds if it ever crashes.
#
# Run from the listener/ folder:
#   bash deploy/install-macos.sh
#
# Manage afterwards:
#   tail -f catcher.log                                                    # logs
#   launchctl unload ~/Library/LaunchAgents/com.attendance.catcher.plist   # stop
#   launchctl load   ~/Library/LaunchAgents/com.attendance.catcher.plist   # start
#   bash deploy/uninstall-macos.sh                                         # remove
#
# Note: a LaunchAgent starts at login. For a fully unattended restart after a
# reboot/power-cut, also enable System Settings -> Users & Groups -> Automatic
# login (requires FileVault off). Either way no punches are lost while it is
# down: the device buffers and re-uploads on reconnect.
#
set -euo pipefail

LABEL="com.attendance.catcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Resolve the listener directory from this script's location, so it works no
# matter the current directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISTENER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "❌ node not found in PATH. Install Node 18+ first."; exit 1; }
[ -f "$LISTENER_DIR/src/server.js" ] || { echo "❌ src/server.js not found in $LISTENER_DIR"; exit 1; }
[ -f "$LISTENER_DIR/.env" ] || echo "⚠️  $LISTENER_DIR/.env not found — create it from .env.example (needs SUPABASE_URL + SUPABASE_SERVICE_KEY) before relying on this."

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file-if-exists=.env</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$LISTENER_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LISTENER_DIR/catcher.log</string>
  <key>StandardErrorPath</key>
  <string>$LISTENER_DIR/catcher.log</string>
</dict>
</plist>
EOF

# (Re)load so re-running cleanly updates an existing install (idempotent).
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ Installed LaunchAgent: $LABEL"
echo "   node:    $NODE_BIN"
echo "   workdir: $LISTENER_DIR"
echo "   logs:    $LISTENER_DIR/catcher.log"
echo
echo "The catcher now starts at login and restarts automatically if it crashes."
echo "Stop the manual 'npm start' (Ctrl+C) if it is still running, then watch:"
echo "   tail -f \"$LISTENER_DIR/catcher.log\""
