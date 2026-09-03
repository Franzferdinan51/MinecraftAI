# AGENTS.md

> Read this first. It is the agent's manual for this repository.

You are an AI coding or research agent about to do work in this repo. This
file is for you, the agent, not the human. It assumes you can read code,
run shell commands, and modify files inside the repository.

## What this repository is

A working stack for running any local LLM as a Minecraft player, and for
populating a vanilla Minecraft world with several AI characters. It is
tested with Minecraft 26.2.

The stack has four moving parts:

1. A vanilla Minecraft 1.21.x server.
2. A Mineflayer-based bot server that wraps a single bot body in an HTTP API
   (`mc` CLI). Forked to support Minecraft 26.2 because the upstream
   Mineflayer + `minecraft-data` package lag.
3. An LM Studio bridge: a Node service that calls the local model every
   six seconds, parses one decision, and issues one `mc` command.
4. A minion controller: five independent Mineflayer processes and
   reasoning loops, each with its own username and API port, using
   `minecraft/minion-controller/config.json`.

These parts are independent. The bot can run without the bridge. The bridge
can be replaced with any other agent framework that can call the `mc` CLI.

## What is **not** in this repository

- **No live server state.** No world saves, no `session.lock`, no live
  bot logs.
- **No upstream packages.** The bot server is the upstream `hermescraft`
  project; the user clones and installs it separately. The 26.2 fork
  only ships the patches and the data overlay.
- **No credentials.** No `~/.hermes/.env`, no API keys, no LM Studio
  tokens, no Minecraft session tokens. Everything is parameterized by
  environment variable.
- **No human names, no real IPs, no machine-specific paths.** Treat any
  path you see as `<repo-root>` or a placeholder.

## How to work in this repository

### Read order

Before you change anything, read in this order:

1. `README.md` — what the project is, what the requirements are.
2. `docs/ARCHITECTURE.md` — the three-layer data flow.
3. `docs/RUNNING.md` — the canonical startup sequence.
4. `docs/TROUBLESHOOTING.md` — the known failure modes.
5. `mineflayer-26.2-fork/README.md` — what the 26.2 fork is and why.
6. The file you actually intend to edit.

### Edit scope

- This repository is a deliverable, not a workspace. Avoid leaving
  agent scratch files (`.bak`, `.tmp`, `.agent-*.log`, etc.) in
  the working tree.
- Do not add a `node_modules/`, build output, or live log to the
  working tree. They are gitignored; do not commit them.
- Do not introduce a new dependency without explaining why in the
  diff message and updating the relevant docs.
- Do not introduce a new global configuration file. Use environment
  variables. Document the variable in the same PR that introduces
  its use.
- Do not commit secrets, even by accident. Run a secret scan before
  staging:
  ```bash
  grep -rEn 'password|SUDO_PASSWORD|api[_-]?key|token' --include='*.md' --include='*.mjs' --include='*.js' --include='*.sh' .
  ```
  (This will match some false positives in `docs/`; review each hit.)

### Coding style

- The bridge and controller are Node 18+ ES modules. Use modern JS.
  No CommonJS in new code. No `any`-style implicit types — write the
  types out in JSDoc where it helps.
- Shell scripts are POSIX-ish Bash. They run on Linux and macOS.
  Quote your variables. Use `set -euo pipefail`.
- Keep the bridge and the controller under 300 lines each. They are
  small on purpose. If you need to add a feature, consider whether it
  belongs in the user-space tools instead.
- Do not introduce a new framework, a new HTTP client, or a new
  logger. The existing dependency footprint (Node stdlib, the `mc`
  CLI, OpenAI-compatible HTTP) is intentional.

### Testing without running a Minecraft server

You can verify your changes parse and require correctly without
running the bot:

```bash
cd lmstudio-bridge && node --check bridge.mjs
cd minecraft/minion-controller && node --check minion-controller.mjs
bash -n minecraft/start-vanilla-server.sh
bash -n minecraft/start-bot-server.sh
bash -n minecraft/start-bridge.sh
bash -n minecraft/start-minion-controller.sh
bash -n minecraft/start-geyser.sh
bash -n minecraft/stop-all.sh
bash -n mineflayer-26.2-fork/install-26.2-fork.sh
```

Run the same `node --check` for any new JS file you add. Run `bash -n`
for any new shell script.

### Testing with a real Minecraft server

If you have a Minecraft server and the bot running, the canonical
smoke test is:

```bash
mc status      # bot is in the world
mc chat "test" # bot is reachable
curl -sS http://127.0.0.1:3002/ | python3 -m json.tool
# inspector returns: ok, model, last_action, last_observation, pending
```

If the inspector returns `pending: true` for more than 30 seconds,
the model is unresponsive. Check `LMS_MODEL` and `LMS_URL`.

## Boundaries

- **Do not** rewrite the entire repo in TypeScript, Rust, or any other
  language. The whole point is that the bridge is a small, easy-to-read
  file that an LLM can use as a template for its own integration.
- **Do not** move the patch list out of `mineflayer-26.2-fork/`. It
  is the most fragile part of the stack and changing its layout will
  break the `install-26.2-fork.sh` script.
- **Do not** add a new protocol level (e.g. Bedrock, Realms). This
  repository is Java edition only.
- **Do not** commit anything under a real path that looks like
  `~/...`. Replace with `$HOME` or a placeholder.

## How the bot sees the world

If you are writing code that observes or controls the bot, remember:

- The bot's world model is approximate. The 26.2 `protocol.json` is
  copied from 26.1 because the upstream `minecraft-data` has not
  shipped a real 26.2 release. The bot cannot decode every packet
  perfectly. The bot's `mc status` works; some advanced features
  (chunked terrain rendering, full chat routing) do not.
- The bot is a real Mineflayer client. If the bot is killed, the
  next tick of the bridge will surface a connection error. Restart
  the bot server; the bridge will reconnect.
- The bridge sends the model a `STATUS:` block plus the last 5 chat
  messages. The model replies with `THINK:` and `ACT:` lines. The
  parser requires this exact format. If you change it, change the
  parser in the same commit.

## How to ask the user

If you get stuck, ask the user one question at a time. The user is
comfortable with bash, Node, and Minecraft. They are less comfortable
with Phoenix/Elixir, Haskell, or Rust. Do not assume they know anything
about reverse-engineering Minecraft protocol packets.

## What the user has actually said (from prior sessions)

- "I want to be able to populate the world with AI." This is the
  central motivation. Anything that makes it easier to add another
  AI character is welcome.
- "Don't do anything too crazy that might break the system." When
  in doubt, prefer the smaller, reversible change.
- "Don't bounce." This means: do not restart the bot server, the
  bridge, or the minion controller without first checking that
  everything else is healthy. If you must restart, use
  `minecraft/stop-all.sh`, wait five seconds, then start the
  component you actually need.

## Layout reference

```text
.
├── README.md
├── LICENSE
├── AGENTS.md                      <-- you are here
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── RUNNING.md
│   ├── LM-STUDIO.md
│   └── TROUBLESHOOTING.md
├── lmstudio-bridge/
│   ├── README.md
│   ├── bridge.mjs
│   └── start.sh
├── minecraft/
│   ├── README.md
│   ├── start-vanilla-server.sh
│   ├── start-bot-server.sh
│   ├── start-bridge.sh
│   ├── start-minion-controller.sh
│   ├── start-geyser.sh
│   ├── stop-all.sh
│   └── minion-controller/
│       ├── config.json
│       ├── minion-controller.mjs
│       └── start.sh
└── mineflayer-26.2-fork/
    ├── README.md
    ├── install-26.2-fork.sh
    ├── data/
    │   └── pc/
    │       ├── 26.2/             (placeholder data, copied from 26.1)
    │       └── common/
    │           └── protocolVersions.json
    ├── data-overrides/           (full files to drop into a bot's node_modules)
    └── patches/                  (unified diffs of the same changes)
```

## Most common agent failure mode

Modifying `lmstudio-bridge/bridge.mjs` or
`minecraft/minion-controller/minion-controller.mjs` without updating
`docs/LM-STUDIO.md` to describe the new env var or behavior. If you
add an option, add a sentence to the env var table the same commit.

## Closing note

This repo is meant to be read end-to-end. The docs are not
boilerplate. If you find a section in the docs that no longer
matches the code, fix the docs in the same commit as the code
change. If a future agent reads a stale doc, they will do the wrong
thing.