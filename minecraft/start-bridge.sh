#!/usr/bin/env bash
# start-bridge.sh — boot the LM Studio bridge.
#
# Usage: ./start-bridge.sh
#
# Prereqs:
#   - Bot server running on 127.0.0.1:3001
#   - LM Studio (or any OpenAI-compatible local LLM) on 127.0.0.1:1234
#   - This repo's lmstudio-bridge/ directory on disk

set -euo pipefail
BRIDGE_DIR="${BRIDGE_DIR:-$HOME/MinecraftAI/lmstudio-bridge}"
if [ ! -d "$BRIDGE_DIR" ]; then
  echo "error: bridge dir not found at $BRIDGE_DIR" >&2
  echo "Clone this repo to \$HOME/MinecraftAI (or set BRIDGE_DIR)" >&2
  exit 2
fi

cd "$BRIDGE_DIR"
exec ./start.sh