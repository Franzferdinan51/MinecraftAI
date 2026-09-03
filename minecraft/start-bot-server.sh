#!/usr/bin/env bash
# start-bot-server.sh — boot the hermescraft Mineflayer bot server.
#
# Usage: ./start-bot-server.sh
#
# Prereqs:
#   - Java 21+ on PATH
#   - Vanilla Minecraft server on 127.0.0.1:25565
#   - The hermescraft bot server repo at $HOME/games/hermescraft/bot
#     (clone https://github.com/bigph00t/hermescraft)
#   - The 26.2 fork applied to the bot's node_modules (see mineflayer-26.2-fork/)

set -euo pipefail
BOT_DIR="${HERMESCRAFT_BOT_DIR:-$HOME/games/hermescraft/bot}"
if [ ! -d "$BOT_DIR" ]; then
  echo "error: hermescraft bot dir not found at $BOT_DIR" >&2
  echo "Clone https://github.com/bigph00t/hermescraft and apply the 26.2 fork first" >&2
  exit 2
fi

if [ ! -d "$BOT_DIR/node_modules" ]; then
  echo "error: $BOT_DIR has no node_modules; run npm install there" >&2
  exit 2
fi

if ! command -v mc >/dev/null; then
  echo "error: 'mc' CLI not on PATH; run hermescraft setup.sh first" >&2
  exit 2
fi

cd "$BOT_DIR"
exec node server.js --mc-host 127.0.0.1 --mc-port 25565 --port 3001