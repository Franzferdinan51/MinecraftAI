#!/usr/bin/env bash
# start-minion-controller.sh — boot the multi-bot controller.
#
# Usage: ./start-minion-controller.sh
#
# Prereqs:
#   - Bot server running on 127.0.0.1:3001
#   - LM Studio on 127.0.0.1:1234
#   - This repo's minecraft/minion-controller/ on disk

set -euo pipefail
CTRL_DIR="${MINION_DIR:-$HOME/MinecraftAI/minecraft/minion-controller}"
if [ ! -d "$CTRL_DIR" ]; then
  echo "error: minion-controller dir not found at $CTRL_DIR" >&2
  exit 2
fi

cd "$CTRL_DIR"
exec ./start.sh