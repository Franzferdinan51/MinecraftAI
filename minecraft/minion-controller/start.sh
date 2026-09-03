#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/minecraft/minion-controller"
CFG="${1:-$HOME/minecraft/minion-controller/config.json}"
exec node "$HOME/minecraft/minion-controller/minion-controller.mjs" --config "$CFG"