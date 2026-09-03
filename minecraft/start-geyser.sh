#!/usr/bin/env bash
# start-geyser.sh — run Geyser Standalone for Bedrock phone clients.
#
# Usage: ./start-geyser.sh
# Default runtime directory: $HOME/minecraft/geyser
# Download the jar first from https://geysermc.org/download/

set -euo pipefail
ROOT="${GEYSER_DIR:-$HOME/minecraft/geyser}"
JAR="${GEYSER_JAR:-$ROOT/Geyser-Standalone.jar}"
JAVA_BIN="${JAVA_BIN:-$(command -v java || true)}"

if [ ! -f "$JAR" ]; then
  echo "error: Geyser jar not found: $JAR" >&2
  echo "Download the standalone jar from https://geysermc.org/download/" >&2
  exit 2
fi
if [ -z "$JAVA_BIN" ]; then
  echo "error: Java 21+ is required" >&2
  exit 2
fi

cd "$ROOT"
exec "$JAVA_BIN" -jar "$JAR"