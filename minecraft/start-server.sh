#!/usr/bin/env bash
# start-server.sh — boot Minecraft Java server + Mission Control web UI + Geyser.
# Mirrors the operator's local ~/minecraft/start-server.sh shipped live.
#
# Order matters: server first (RCON), then WebUI which connects to live
# bot API ports, then optional Geyser for Bedrock/phone clients.
#
# Usage:
#   ./minecraft/start-server.sh
#
# Environment overrides:
#   WEBUI_PORT       Mission Control port (default 3100)
#   GEYSER_PORT      UDP port Bedrock phones use (default 19132)
#   GEYSER_DIR       Where Geyser-Standalone.jar lives (default ~/minecraft/geyser)
#   MC_RAM           Java heap size (default 6G)

set -euo pipefail
mkdir -p "$HOME/minecraft/server/logs"
cd "$HOME/minecraft/server"
LOG="$HOME/minecraft/server/logs/server-$(date +%F-%H%M%S).log"
echo "Starting server, log: $LOG"

WEBUI_PORT="${WEBUI_PORT:-3100}"
if ! ss -ltn 2>/dev/null | grep -q ":${WEBUI_PORT}\b"; then
  if [ -x "$HOME/MinecraftAI/webui/start.sh" ]; then
    echo "Starting Mission Control web UI on 127.0.0.1:${WEBUI_PORT}"
    WEBUI_PORT="$WEBUI_PORT" nohup "$HOME/MinecraftAI/webui/start.sh" >>"$HOME/minecraft/server/logs/webui-$(date +%F).log" 2>&1 &
  else
    echo "Web UI starter not found at $HOME/MinecraftAI/webui/start.sh; skipping" >&2
  fi
else
  echo "Web UI already listening on :${WEBUI_PORT}; skipping"
fi

# Geyser (Bedrock / phone Minecraft clients) — start if 19132 is free.
GEYSER_PORT="${GEYSER_PORT:-19132}"
if ! ss -lunp 2>/dev/null | grep -q ":${GEYSER_PORT}\b"; then
  GEYSER_DIR="${GEYSER_DIR:-$HOME/minecraft/geyser}"
  if [ -f "$GEYSER_DIR/Geyser-Standalone.jar" ] && [ -x "$(command -v java)" ]; then
    echo "Starting Geyser on UDP ${GEYSER_PORT}"
    ( cd "$GEYSER_DIR" && nohup "$(command -v java)" -jar Geyser-Standalone.jar >>"$HOME/minecraft/server/logs/geyser-$(date +%F).log" 2>&1 & )
  else
    echo "Geyser jar missing at $GEYSER_DIR/Geyser-Standalone.jar; skipping"
  fi
else
  echo "Geyser already listening on UDP :${GEYSER_PORT}; skipping"
fi

exec /usr/lib/jvm/java-25-openjdk/bin/java -Xms2G -Xmx6G -jar server.jar nogui 2>&1 | tee -a "$LOG"
