# MinecraftAI

Make any local LLM (or a remote one) play Minecraft 1.21.11+ with you, and
populate the world with multiple AI characters. Built on [Mineflayer],
[hermescraft], and an [LM Studio] back-end.

This repository does not include any live server state, secrets, real
credentials, or private notes. Everything in `docs/` is documentation,
`mineflayer-26.2-fork/` is the patched package data, `minecraft/` and
`lmstudio-bridge/` are the integration scripts, and `scripts/` is the
start/stop helper set.

## What this is

Three things, layered:

1. **Mineflayer fork that supports Minecraft 26.2** (`mineflayer-26.2-fork/`)
   The upstream Mineflayer + `minecraft-data` package was lagging behind
   Minecraft 26.2 (protocol 776). This repo documents the patch set and
   provides the data overlay used to talk to 26.2 servers.
2. **LM Studio Bridge** (`lmstudio-bridge/`) — a Node service that takes any
   OpenAI-compatible local model (LM Studio, Ollama, vLLM, etc.), gives it
   a `mc status` / `mc chat` loop, and writes its decisions back through the
   `mc` CLI. The bot is real, the body is real, the world is real.
3. **Minion Controller** (`minecraft/minion-controller/`) — the same
   reasoning loop, in parallel, for several bot bodies. Lets you populate a
   vanilla world with a small cast of named characters (Steve, Reed, Moss,
   Flint, Ember, ...) all driven by local models.

## Quick start

```bash
# 1. Start a vanilla Minecraft 1.21.x server. Java 21+ required.
# 2. Add the bot to your profile and start it.
git clone https://github.com/YOURNAME/MinecraftAI.git
cd MinecraftAI/lmstudio-bridge && LMS_MODEL=ornith-1.5-9b ./start.sh
# 3. Talk to the bot from your Minecraft client. Connect to localhost.

# To run multiple bots:
cd MinecraftAI/minecraft/minion-controller && ./start.sh
```

## How it works

```text
LM Studio (local)
   ↓ chat completion
bridge.mjs
   ↓ parses THINK:/ACT:
mc CLI
   ↓ HTTP
hermescraft bot server (Mineflayer)
   ↓ Minecraft protocol
the world
```

The bridge is a tiny HTTP relay. It calls your model every 6 seconds with
the bot's status and recent chat, parses one decision back, and issues one
`mc` command. The model is the brain, the bridge is the spinal cord, the
`mc` server is the body.

## Files in this repo

- `docs/` — architecture, fork rationale, troubleshooting
- `mineflayer-26.2-fork/` — the data and patch files for Mineflayer 26.2 support
- `lmstudio-bridge/` — the single-bot LM Studio bridge
- `minecraft/minion-controller/` — the multi-bot controller
- `minecraft/hermescraft-fork/` — the upstream hermescraft bot server, unmodified
- `scripts/` — convenience start/stop scripts

## Requirements

- Linux or macOS
- Java 21+ (Minecraft 26.x uses class files that Java 21 cannot read)
- Node 18+
- A running vanilla Minecraft server you can connect to (`online-mode=false`
  in `server.properties` so the bot can join without a Mojang account)
- An OpenAI-compatible local LLM endpoint (default: LM Studio on
  `http://127.0.0.1:1234/v1`)

## License

MIT for the bridge, controller, and documentation. The
`mineflayer-26.2-fork/` and `minecraft/hermescraft-fork/` are
submodules kept in sync with their upstream projects and inherit each
upstream's license.

## Why this exists

I wanted an embodied AI in a real Minecraft world, not a benchmark or a
screenshot generator. The 26.2 protocol gap kept breaking every published
AI mod. This repo is the fix: a working bot body plus a small, transparent
bridge that any local model can drive.