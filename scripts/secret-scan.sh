#!/usr/bin/env bash
# Scan tracked/staged source and docs for likely accidental secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

patterns='(SUDO_PASSWORD[[:space:]]*=|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|password[[:space:]]*=[[:space:]]*[^<[:space:]"'"'"']+|api[_-]?key[[:space:]]*[:=][[:space:]]*[^<[:space:]"'"'"']+|Bearer[[:space:]]+[A-Za-z0-9._-]{20,})'

# Scan source/docs only; generated Minecraft data can contain unrelated words.
if grep -RInE "$patterns" --exclude-dir=.git --exclude-dir=node_modules \
    --exclude='*.json' --include='*.md' --include='*.mjs' --include='*.js' --include='*.sh' .; then
  echo "secret-scan: possible secret found" >&2
  exit 1
fi

echo "secret-scan: PASS"
