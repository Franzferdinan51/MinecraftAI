#!/usr/bin/env bash
set -euo pipefail
export BRIDGE_PORT="${BRIDGE_PORT:-3002}"
export BRIDGE_MODE="${BRIDGE_MODE:-alongside}"
export LMS_MODEL="${LMS_MODEL:-ornith-1.5-9b}"
exec node "$HOME/minecraft/lmstudio-bridge/bridge.mjs"