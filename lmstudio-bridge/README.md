# LM Studio Minecraft Bridge

A standalone Node service that lets any LM Studio chat model drive the same
Mineflayer bot body that Hermes Bots use. No changes to the Minecraft
server; no Mineflayer code of our own; just an HTTP relay that translates
LM Studio chat completions into `mc` CLI calls.

## Two modes

- `alongside` (default) — Run *both* Hermes and LM Studio against the same bot
  body. The LM Studio model observes and proposes; you pick who drives.
- `independent` — Run the LM Studio model as a separate bot body alongside
  Hermes. Each has its own login, its own inventory, its own memory.

## Run it

```bash
~/minecraft/lmstudio-bridge/start.sh
```

Then watch the bridge inspector:

```text
http://127.0.0.1:3002/
```

The inspector shows the latest observation passed to the model and the last
action taken. Defaults to the `google/gemma-4-26b-a4b-qat` model already
served by LM Studio on this machine.

## Configuration

| Variable          | Default                                       | Description                                   |
|--|--|--|
| `LMS_URL`        | `http://127.0.0.1:1234/v1`                    | LM Studio OpenAI-compatible base URL        |
| `LMS_MODEL`      | `google/gemma-4-26b-a4b-qat`                  | Model id                                     |
| `BRIDGE_MODE`    | `alongside`                                   | `alongside` or `independent`                 |
| `BRIDGE_PORT`    | `3002`                                        | Bridge inspector HTTP port                   |
| `BOT_USERNAME`   | `GemmaBot`                                    | Minecraft bot username (independent mode)    |
| `DECISION_INTERVAL_MS` | `6000`                                   | How often the model gets a new turn          |

## How to pair with Hermes Bots

`alongside` mode is meant to share the existing `bot/server.js` process that
`hermescraft` already runs. Hermes Bots continue to use `mc` as normal. The
LM Studio bridge opens its own decision loop that calls `mc` and shares the
same bot body. Use `mc chat "..."` from the Hermes profile; the LM Studio
model reads chat on its next tick and reacts.

`independent` mode is for when you want two distinct characters in the same
world. Edit `hermescraft/bot/server.js` to start a second bot body, then
point this bridge at it via the `BRIDGE_PORT` and `BOT_USERNAME` settings.

## Files

- `bridge.mjs` — Node service. Reads `mc`, calls LM Studio, writes `mc` back.
- `start.sh` — Wrapper that picks up env vars and execs `node bridge.mjs`.

## Limits

- LM Studio local models are slower than cloud APIs. 6 s per turn keeps a
  single bot in sync without burning CPU.
- The bridge does not own chat routing. If you want Hermescraft's bot to
  speak *only* through Hermes and the LM Studio model to speak *only*
  through its own bridge, split them into two bot bodies (`independent`
  mode).
- Local models will not produce the same reasoning quality as frontier
  models. Use for low-stakes gathering, building, exploration, not PvP.