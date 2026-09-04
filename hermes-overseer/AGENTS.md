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

## Why ornith-1.5-9b (local, via LM Studio)

Fleet brain as of 2026-09-03: `ornith-1.5-9b`, the same model that drives
the minion-controller bridge loop — one resident model serves both the
autonomous ticks and the six agent minds.

- True architecture window verified in the GGUF header (`qwen35`,
  `context_length = 262144`). LM Studio currently serves it at 50,176
  (its load-time setting), so each profile sets
  `model.context_length=262144` — the architecture-true value, never
  invented. Hermes requires ≥ 64,000 to boot.
- Caveat: short observe → act loops (the fleet's normal pattern) stay far
  under the server's 50K loaded window. Marathon sessions would need LM
  Studio's loaded context raised (VRAM permitting — a future change, not
  done now to protect the live bridge).
- Earlier candidates: `gemma-4-12b-qat` meets 64K and served 4/6 agents
  (kept as fallback); `gemma-4-26b` / `ornith-1.5-35b` fail to load in
  LM Studio; `nemotron-3-nano-4b` (8K) rejected as main and compressor.

## Switching models (fleet stays changeable)

One command, all six profiles — `hermes config set` under the hood,
never hand-edited:

```bash
scripts/fleet-model.sh ornith-1.5-9b 262144
scripts/fleet-model.sh google/gemma-4-12b-qat   # fallback, no override needed
```

Then verify each mind against its body:

```bash
HERMES_HOME=~/.hermes/profiles/minecraft-moss hermes chat -q \
  "Run 'mc status' via the terminal, then reply with exactly: your name, health, food, and position. Nothing else."
```

## Smoke-test log (2026-09-03, ornith-1.5-9b)

- Steve ✅ · Reed ✅ 20/20 @ 52.5,63,77.5 · Moss ✅ 20/20 @ -15.3,68,25.7 ·
  Flint ✅ 20/20 @ 50.5,63,85.5 · Ember ✅ 20/20 @ 51.4,62,78.5 ·
  GemmaBot ✅ 16.3/20 @ 47.5,63,84.5 (still recovering — rescue first).
- 6/6 minds verified against their own bodies. Reed/Ember's earlier
  `gemma-4-12b` engine flap is moot: the resident 9b loads every time.

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
