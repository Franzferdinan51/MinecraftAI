# MinecraftAI

Make any local LLM play Minecraft 1.21.11+ with you, and populate a
vanilla world with several AI characters. Built on [Mineflayer],
[hermescraft], and an [LM Studio] back-end.

**DuckBot** leads the fleet: six HermesCraft landfolk agents
(DuckBot + Steve, Reed, Moss, Flint, Ember) sharing one switchable
local brain (`ornith-1.5-9b`), coordinated in game chat, verified
live at 20/20.

This repository does not include any live server state, secrets,
real credentials, or private notes.

> Are you an AI agent? Read [`AGENTS.md`](./AGENTS.md) first.

## Server quick reference

When you have everything running, the server is on:

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Edition         | **Java Edition** only (not Bedrock)       |
| Minecraft ver.  | 1.21.x (tested on 26.2, protocol 776)     |
| Address         | `<your-machine>:25565` (LAN/local)         |
| Username        | `DuckBot` (leader; minions: `Steve`, `Reed`, `Moss`, `Flint`, `Ember`) |
| Auth mode       | `online-mode=false` (offline / LAN friendly) |
| Bot bodies      | DuckBot `:3001`, Steve `:3011`, Reed `:3012`, Moss `:3013`, Flint `:3014`, Ember `:3015` |
| LM Studio bridge| `http://127.0.0.1:3002/` (inspector)      |
| Minion Ctrl     | `http://127.0.0.1:3003/` (inspector)      |
| Mission Control | `http://127.0.0.1:3100/` (desktop + mobile) |
| Default model   | `ornith-1.5-9b` (switchable via `scripts/fleet-model.sh`) |

### Connecting from a phone

- **Java edition** (recommended for full functionality): PojavLauncher
  on Android; the official Minecraft app on iOS is Java edition and
  works against a Java server. Point the client at
  `<your-machine>:25565`. If you are not on the same network,
  expose port 25565 (or put Tailscale / wireguard in front).
- **Bedrock edition** (your phone's default Minecraft app): the
  Java server does not speak Bedrock's protocol. To play from a
  Bedrock client, install [Geyser](https://geysermc.org/) and
  [Floodgate](https://wiki.geysermc.org/floodgate/) alongside the
  bot server. See [`docs/RUNNING.md`](./docs/RUNNING.md#bedrock-players)
  for the recipe.

## What this is

Three things, layered:

1. **Mineflayer fork that supports Minecraft 26.2**
   (`mineflayer-26.2-fork/`)
   The upstream Mineflayer + `minecraft-data` package was lagging
   behind Minecraft 26.2 (protocol 776). This repo documents the
   patch set and provides the data overlay used to talk to 26.2
   servers.
2. **LM Studio Bridge** (`lmstudio-bridge/`) — a Node service that
   takes any OpenAI-compatible local model, gives it a
   `mc status` / `mc chat` loop, and writes its decisions back through
   the `mc` CLI. The bot is real, the body is real, the world is real.
3. **Minion Controller** (`minecraft/minion-controller/`) — the same
   reasoning loop, in parallel, for several independent bot bodies. Each
   minion has its own Mineflayer process, Minecraft username, API port,
   inventory, location, model, and tick interval. This is what populates
   the world with actual AI players; it does not send five prompts to
   DuckBot.

## Quick start

```bash
# 1. Start a vanilla Minecraft 1.21.x server.
#    (see minecraft/start-vanilla-server.sh)
# 2. Apply the 26.2 fork to your bot's node_modules.
#    (see mineflayer-26.2-fork/install-26.2-fork.sh)
# 3. Start the bot server.
minecraft/start-bot-server.sh
# 4. Optional: start Geyser for Bedrock phone clients.
minecraft/start-geyser.sh
# 5. Start the LM Studio bridge.
minecraft/start-bridge.sh
# 6. Connect with your Minecraft client.
#    Server address: localhost:25565 (or batman-2:25565 from the LAN)
```

For multiple AI characters:

```bash
minecraft/start-minion-controller.sh
```

Default model is `ornith-1.5-9b`. Override with `LMS_MODEL=...` on the
bridge/controller env. See [`docs/LM-STUDIO.md`](./docs/LM-STUDIO.md).

## How it works

```text
LM Studio (local)
   ↓ chat completion
bridge.mjs / Minion Controller
   ↓ validated bot actions
mc CLI
   ↓ HTTP
hermescraft bot server (Mineflayer)
   ↓ Minecraft protocol
the world
```

The bridge is a tiny HTTP relay. It calls your model with the bot's
status and recent chat, parses one decision back, and issues one `mc`
command. The model is the brain, the bridge is the spinal cord, the
`mc` server is the body.

Mission Control (`webui/`) aggregates the six bot APIs, controller,
LM Studio bridge, team radio, inventories, queues, terrain, and
allowlisted server operations into one responsive local command
station. It is designed for both desktop and mobile browsers.

## HermesCraft fleet (live)

MinecraftAI runs a supervised HermesCraft team, not independent model
loops. All six agents are Hermes agents on the switchable
`ornith-1.5-9b` brain (see `scripts/fleet-model.sh`), each with its
own isolated profile, body, and role skills — DuckBot (overseer),
Steve (foreman), Reed (builder), Moss (farmer), Flint (miner), Ember
(guardian). Full upstream hermescraft behavior and modes are adopted and
synthesized (see `minecraft/hermescraft/` and `docs/THIRD-PARTY.md`):
Companion, Civilization, Landfolk, Minecraft Core, and Play/Server
flows are cataloged in `minecraft/hermescraft/modes.json`; Landfolk is
the active six-agent fleet. The Mission Control **HermesCraft modes**
view exposes this mapping, capabilities, provenance, and per-agent
body/profile wiring, and the full grouped `mc` command surface
(observation, actions, social, world state, and fleet extensions) without exposing secrets or offering an unsafe
bulk launcher. The integrated behavior includes landfolk character
craft, role skillbooks, inventory-first play, SUBMERGED recovery,
one-line chat with whisper coordination, and a 3-observations-to-1-action loop.

The roadmap gives each character explicit, bounded powers:

- **DuckBot:** overseer planning, incident review, research requests,
  work-board design, shared-memory synthesis, and skill recommendations.
- **Steve:** construction foreman and material preflight.
- **Reed:** approved bounded build cards and completion verification.
- **Moss:** food, farming, depot, and logistics procedures.
- **Flint:** safe quarry batches, resource reports, and depot returns.
- **Ember:** dry-route surveys, hazard reporting, and health-bounded defense.

A power is a named, testable Minecraft capability—not unrestricted
computer access. Models may propose work, but deterministic code will
validate role permissions, protected areas, dry-ground safety, task
leases, resource budgets, idempotency, and post-action evidence before
an action is queued. New build footprints, water-enabled work, new
skills, model-profile changes, and protected-boundary work require an
explicit Mission Control approval.

The planned rollout is `observe` → `shadow` → one-bot `canary` →
`active`. Learning is limited to redacted, inspectable outcomes from
verified work receipts; a learned procedure must be approved before it
becomes a shared reusable skill. Bots will not receive raw shell,
filesystem, browser, credentials, arbitrary RCON, or unrestricted MCP
access.

> **Current status (2026-09-04):** live and verified — DuckBot body
> `:3001` plus five minion bodies `:3011`–`:3015` all connected at
> 20/20, controller + bridge healthy with zero LM errors, 123/123
> tests green (`tests/` + `minecraft/bot-server/test/`), secret scan
> clean. Known benign warnings: the 26.2 protocol fork still logs
> particle / entity-metadata decode shorts (`sonic_boom`,
> `world_particles`) — fixture-pinned, no fleet restarts. Do not
> replace it with an upstream dependency update without fixture tests
> and a one-bot canary.

## What's in the repo

- [`README.md`](./README.md) — this file
- [`AGENTS.md`](./AGENTS.md) — for AI agents working on this repo
- [`LICENSE`](./LICENSE) — MIT
- `docs/` — architecture, running, LM Studio config, troubleshooting, `THIRD-PARTY.md` (hermescraft MIT attribution)
- `lmstudio-bridge/` — the single-bot LM Studio bridge
- `minecraft/` — bot server, minion controller, intelligence (contracts, shadow audit, journal), protocol fixtures, `hermescraft/` (vendored **all upstream modes**: Companion, Civilization, Landfolk, Minecraft Core, Play/Server; adapted prompts, SOULs, skill guides, and `modes.json` catalog)
- `hermes-overseer/` — overseer request builder, fleet roster (`AGENTS.md`)
- `webui/` — Mission Control (desktop + mobile)
- `tests/` + `minecraft/bot-server/test/` — 123 green (run: `node --test tests/*.test.mjs minecraft/bot-server/test/*.test.js`)
- `.github/workflows/ci.yml` — CI: tests, syntax, secret scan
- `scripts/` — `fleet-model.sh` (switchable brain), `secret-scan.sh` (run before every commit)
- `mineflayer-26.2-fork/` — patches, data overlay, installer for 26.2

## Files outside the repo you also need

The repository does not include the upstream packages. Clone them
yourself:

```bash
git clone https://github.com/bigph00t/hermescraft.git ~/games/hermescraft
cd ~/games/hermescraft/bot && npm install

# Optional: Prism Launcher for the Minecraft client
# https://prismlauncher.org/

# Optional: LM Studio
# https://lmstudio.ai/
```

## Requirements

- Linux or macOS
- Java 21+ (Minecraft 1.21.x will not start on Java 17 or older;
  tested on Java 25)
- Node 18+
- A running vanilla Minecraft server you can connect to
  (`online-mode=false` in `server.properties` so the bot can join
  without a Mojang account)
- An OpenAI-compatible local LLM endpoint (default: LM Studio on
  `http://127.0.0.1:1234/v1`)

## License

MIT for the bridge, controller, and documentation. The
`mineflayer-26.2-fork/` and the upstream `hermescraft` bot server
each carry their own upstream license. The bot's protocol data
(`mineflayer-26.2-fork/data/pc/`) is sourced from
`PrismarineJS/minecraft-data` (BSD-3-Clause).

## Why this exists

I wanted an embodied AI in a real Minecraft world, not a benchmark or
a screenshot generator. The 26.2 protocol gap kept breaking every
published AI mod. This repo is the fix: a working bot body plus a
small, transparent bridge that any local model can drive.

## Contributing

Read [`AGENTS.md`](./AGENTS.md) before opening a PR. Run a secret scan
before staging. If you change a behavior, update the matching
section in `docs/`.