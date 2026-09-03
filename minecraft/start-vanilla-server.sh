#!/usr/bin/env bash
# start-vanilla-server.sh — boot a vanilla Minecraft 1.21.x server.
#
# Usage: ./start-vanilla-server.sh /path/to/server-root
# Defaults to $HOME/minecraft/server
#
# This is a convenience wrapper. The server is upstream Mojang code and is
# not included in this repository. Download server.jar from
# https://piston-data.mojang.com and place it inside the server root.

set -euo pipefail
ROOT="${1:-$HOME/minecraft/server}"
JAR="$ROOT/server.jar"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

if [ ! -f "$JAR" ]; then
  echo "error: $JAR not found" >&2
  echo "Download a 1.21.x server.jar from Mojang and place it in $ROOT" >&2
  exit 2
fi

if [ ! -f "$ROOT/eula.txt" ]; then
  echo "eula=true" > "$ROOT/eula.txt"
  echo "Wrote $ROOT/eula.txt (default accept)"
fi

# Java 21+ is required for Minecraft 1.21.x
JAVA_BIN="$(command -v java)"
if [ -z "$JAVA_BIN" ]; then
  echo "error: java not found in PATH" >&2
  exit 2
fi

# 2 GB minimum, 6 GB default; override with MC_RAM env var
HEAP="${MC_RAM:-6G}"
exec "$JAVA_BIN" -Xms2G -Xmx"$HEAP" -jar "$JAR" nogui