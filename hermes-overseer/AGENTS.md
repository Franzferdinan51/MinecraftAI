# HermesCraft Agent Fleet — all six bots are Hermes agents

Every bot body is driven by its own isolated Hermes profile. Same brain
server, same contract, different bodies, roles, and memories.

## Roster

| Agent profile         | Role     | Body (MC_API_URL)         |
|-----------------------|----------|---------------------------|
| `minecraft-gemma-bot` | overseer | HermesBot — port 3001     |
| `minecraft-steve`     | foreman  | Steve — port 3011         |
| `minecraft-reed`      | builder  | Reed — port 3012          |
| `minecraft-moss`      | farmer   | Moss — port 3013          |
| `minecraft-flint`     | miner    | Flint — port 3014         |
| `minecraft-ember`     | guardian | Ember — port 3015         |

## Per-profile wiring (all six identical shape)

- `config.yaml` (via `hermes config set`, never hand-edited):
  `model.provider=custom`, `model.base_url` → local LM Studio `/v1`,
  credentials via the LM Studio placeholder key in each profile's own
  config (set with `hermes config set`, never hand-edited),
  `model.default=google/gemma-4-12b-qat`.
- `.env`: `MC_API_URL=http://localhost:<port>` — binds the agent to ITS
  body. Default `mc` target is port 3001, so this is what stops every
  agent from driving HermesBot.
- `SOUL.md`: original Landfolk persona + appended `HermesCraft Agent
  Contract` (role, Tier 1/2/3 capability tiers, 8-block house radius at
  (50,63,85), dry-ground-only, in-game-chat coordination, safety beats
  goals).
- `hermes profile describe`: one-line role for the kanban router.

## Why gemma-4-12b-qat (local, via LM Studio)

- `ornith-1.5-9b` (bridge model) reports 50,176 tokens — Hermes needs
  ≥ 64,000. Rejected at init.
- `google/gemma-4-26b-a4b-qat` and `ornith-1.5-35b-a3b` fail to load in
  LM Studio (`Engine protocol startup was aborted`). Left alone — the
  live bridge depends on a healthy LM Studio.
- `nvidia/nemotron-3-nano-4b` reports 8,192 — rejected as main and as
  auxiliary compression model.
- `gemma-4-12b-qat` meets the 64K bar, loads, and follows the
  observe → act → report loop. Verified per agent with
  `hermes chat -q "Run 'mc status' …"` under each profile's
  `HERMES_HOME`.

## Smoke-test log (2026-09-03)

- Steve ✅ 20/20 @ 51.4,62,78.5 · Moss ✅ 20/20 @ -15.3,68,25.7 ·
  Flint ✅ 7.2/20 @ 48.5,63,77.6 · GemmaBot ✅ 16.3/20 @ 47.5,63,84.5
- Reed/Ember: configured identically; first attempts hit a transient
  LM Studio engine flap (12b worker refusing reload after serving four
  agents). Retried after engine rest — see commit history for final
  status. Steady-state config is uniform; no per-agent divergence.

## Run one

```bash
HERMES_HOME=~/.hermes/profiles/minecraft-moss hermes chat -q \
  "Check mc status and mc read_chat, then do one useful farm task."
```

## Boundaries (mirror `minecraft/intelligence/` policy)

Agents propose Tier 3 work (big builds, fire/lava, redstone,
server-wide effects, new zones, over-water construction) in game chat
and wait for the player. The minion-controller gateway stays the
dispatch authority for autonomous ticks; agents are the minds, the
controller + `mc` CLI are the hands. Never expose RCON, shell, or
secrets to game chat.
