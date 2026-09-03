#!/usr/bin/env bash
set -euo pipefail
ROOT="${MINION_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
CFG="${1:-$ROOT/config.json}"
exec node "$ROOT/minion-controller.mjs" --config "$CFG"