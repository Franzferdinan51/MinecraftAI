# MinecraftAI

Make any local LLM play Minecraft 1.21.11+ with you, and populate a
vanilla world with several AI characters. Built on [Mineflayer],
[hermescraft], and an [LM Studio] back-end.

This repository does not include any live server state, secrets,
real credentials, or private notes.

> Are you an AI agent? Read [`AGENTS.md`](./AGENTS.md) first.

## Server quick reference

When you have everything running, the server is on:

| Field           | Value                                      |
|--|--|
| Edition         | **Java Edition** only (not Bedrock)       |
| Minecraft ver.  | 1.21.x (tested on 26.2, protocol 776)     |
| Address         | `<your-machine>:25565` (LAN/local)         |
| Username        | `DuckBot` (the AI's in-world identity)   |
| Auth mode       | `online-mode=false` (offline / LAN friendly) |
| Bot bridge      | `http://127.0.0.1:3001/` (`mc` CLI talks here) |
| LM Studio bridge| `http://127.0.0.1:3002/` (inspector)      |
| Minion Ctrl     | `http://127.0.0.1:3003/` (inspector)      |
| Default model   | `ornith-1.5-9b` (any LM Studio / Ollama / vLLM works) |

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

## HermesCraft intelligence roadmap

MinecraftAI is evolving from independent model loops into a supervised
HermesCraft team. The implementation plan is
[`HermesCraft Overseer and Minion Powers`](./.hermes/plans/2026-09-03_205152-hermescraft-overseer-and-minion-powers.md).

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

> **Current status:** This capability gateway, shared skillbook, and
> learning system are planned—not yet enabled in live gameplay. The
> existing Minecraft 26.2 protocol fork also has known particle and
> entity-metadata decode warnings. Do not replace it with an upstream
> dependency update without fixture tests and a one-bot canary.

## What's in the repo

- [`README.md`](./README.md) — this file
- [`AGENTS.md`](./AGENTS.md) — for AI agents working on this repo
- [`LICENSE`](./LICENSE) — MIT
- `docs/` — architecture, running, LM Studio config, troubleshooting
- `lmstudio-bridge/` — the single-bot LM Studio bridge
- `minecraft/` — convenience scripts and the minion controller
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