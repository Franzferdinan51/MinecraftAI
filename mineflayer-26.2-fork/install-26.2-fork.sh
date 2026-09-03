#!/usr/bin/env bash
# install-26.2-fork.sh — apply the 26.2 patches to a bot's node_modules.
#
# Usage:
#   ./install-26.2-fork.sh /path/to/bot/node_modules
#
# What it does:
#   1. Backs up each file it is about to touch into .26.2-fork-backup-<ts>/
#   2. Copies data/pc/common/protocolVersions.json from this repo's
#      mineflayer-26.2-fork/ into the bot's installed minecraft-data
#   3. Copies data/pc/26.2/ from this repo's mineflayer-26.2-fork/ into
#      the bot's installed minecraft-data
#   4. Patches the version.js, data.js, chunk map, and features.json
#      files in the bot's node_modules
#
# Idempotent. Re-running on a patched tree is safe.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/bot/node_modules" >&2
  exit 2
fi
NM="$1"
FORK_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${NM}/.26.2-fork-backup-$(date +%Y%m%d%H%M%S)"

if [ ! -d "$NM/minecraft-data" ] || [ ! -d "$NM/mineflayer" ]; then
  echo "error: $NM does not look like a node_modules tree" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
echo "Backups -> $BACKUP_DIR"

backup() {
  local rel="$1"
  if [ -e "$NM/$rel" ] && [ ! -e "$BACKUP_DIR/$rel" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -a "$NM/$rel" "$BACKUP_DIR/$rel"
  fi
}
apply() {
  local rel="$1"
  local src="$FORK_DIR/$2"
  if [ ! -e "$src" ]; then
    echo "skip $rel (no source)"
    return
  fi
  backup "$rel"
  mkdir -p "$NM/$(dirname "$rel")"
  cp -a "$src" "$NM/$rel"
  echo "wrote $rel"
}

echo "== Copying data overlay =="
apply "minecraft-data/minecraft-data/data/pc/common/protocolVersions.json" "data/pc/common/protocolVersions.json"
apply "minecraft-data/minecraft-data/data/pc/26.2" "data/pc/26.2"
# Force the 26.2 version.json to declare protocol 776
if [ -f "$NM/minecraft-data/minecraft-data/data/pc/26.2/version.json" ]; then
  backup "minecraft-data/minecraft-data/data/pc/26.2/version.json"
  python3 - <<PY
import json, pathlib
p = pathlib.Path("$NM/minecraft-data/minecraft-data/data/pc/26.2/version.json")
d = json.load(open(p))
d['version'] = 776
d['minecraftVersion'] = '26.2'
d['dataVersion'] = 4903
d['usesNetty'] = True
d['majorVersion'] = '26.2'
d['releaseType'] = 'release'
p.write_text(json.dumps(d, indent=2))
PY
  echo "wrote 26.2/version.json (protocol 776)"
fi

echo "== Applying whitelist patches =="
for f in minecraft-data/data.js minecraft-protocol/src/version.js mineflayer/lib/version.js prismarine-chunk/src/index.js prismarine-physics/lib/features.json; do
  backup "$f"
done
cp "$FORK_DIR/data-overrides/data.js" "$NM/minecraft-data/data.js"
cp "$FORK_DIR/data-overrides/minecraft-protocol-version.js" "$NM/minecraft-protocol/src/version.js"
cp "$FORK_DIR/data-overrides/mineflayer-version.js" "$NM/mineflayer/lib/version.js"
cp "$FORK_DIR/data-overrides/prismarine-chunk-index.js" "$NM/prismarine-chunk/src/index.js"
cp "$FORK_DIR/data-overrides/prismarine-physics-features.json" "$NM/prismarine-physics/lib/features.json"
echo "All whitelists applied."

echo
echo "Done. Restart your bot server."
echo "Backups live at: $BACKUP_DIR"