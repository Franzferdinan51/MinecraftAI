#!/usr/bin/env bash
# fleet-model.sh — switch the brain for all six HermesCraft agents at once.
# Models come and go in LM Studio; this keeps the fleet changeable with one
# command instead of six manual config edits.
#
# Usage:
#   scripts/fleet-model.sh ornith-1.5-9b [context_length]
#   scripts/fleet-model.sh google/gemma-4-12b-qat
#
# context_length is only needed when LM Studio reports a window smaller than
# the model's true architecture window (verified in the GGUF header, e.g.
# ornith-1.5-9b is arch qwen35 with 262144). Hermes requires >= 64000.
# Never invent this number — read it from the model file.
#
# Uses `hermes config set` per profile (never hand-edits config.yaml).
set -euo pipefail

PROFILES=(minecraft-gemma-bot minecraft-steve minecraft-reed minecraft-moss minecraft-flint minecraft-ember)
MODEL="${1:?usage: fleet-model.sh <model-id> [context_length]}"
CTX="${2:-}"

for p in "${PROFILES[@]}"; do
  export HERMES_HOME="$HOME/.hermes/profiles/$p"
  hermes config set model.default "$MODEL" >/dev/null
  if [ -n "$CTX" ]; then
    hermes config set model.context_length "$CTX" >/dev/null
  fi
  echo "$p -> $MODEL${CTX:+ (ctx $CTX)}"
done

echo "--- verify:"
grep -H "default:\|context_length" "$HOME"/.hermes/profiles/minecraft-*/config.yaml
