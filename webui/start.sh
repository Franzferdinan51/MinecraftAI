#!/usr/bin/env bash
# start.sh — boot Mission Control web UI (port 3100, node stdlib only).
#
# Usage: ./start.sh
#
# Prereqs:
#   - node 18+ on PATH
#   - This repo's webui/ directory on disk
#
# Env:
#   WEBUI_PORT — listen port (default 3100)

set -euo pipefail
WEBUI_DIR="${WEBUI_DIR:-$HOME/MinecraftAI/webui}"
if [ ! -f "$WEBUI_DIR/server.mjs" ]; then
  echo "error: webui server not found at $WEBUI_DIR/server.mjs" >&2
  echo "Clone this repo to \$HOME/MinecraftAI (or set WEBUI_DIR)" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found in PATH" >&2
  exit 2
fi

cd "$WEBUI_DIR"
PORT="${WEBUI_PORT:-3100}"
echo "Starting Mission Control web UI on 127.0.0.1:$PORT"
exec node server.mjs
