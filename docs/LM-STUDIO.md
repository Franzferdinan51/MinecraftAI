# LM Studio bridge configuration

## Environment variables

| Variable          | Default                                     | Description                              |
|--|--|--|
| `LMS_URL`        | `http://127.0.0.1:1234/v1`                  | OpenAI-compatible base URL            |
| `LMS_MODEL`      | `ornith-1.5-9b`                            | Model id (must be loaded in LM Studio) |
| `BRIDGE_MODE`    | `alongside`                                 | `alongside` (shared bot) or `independent` (own bot) |
| `BRIDGE_PORT`    | `3002`                                      | HTTP inspector port                   |
| `BOT_USERNAME`   | `GemmaBot`                                  | Username for the bot body (`independent` mode only) |
| `DECISION_INTERVAL_MS` | `6000`                                | How long to wait between ticks         |
| `MC_CLI`         | `$HOME/.local/bin/mc`                      | Path to the `mc` CLI                   |

## Models we have used

| Model                       | Use case                                           |
|--|--|
| `ornith-1.5-9b`           | Default. Fast on CPU. Edible decisions.         |
| `google/gemma-4-26b-a4b-qat` | Better reasoning, slower ticks.                  |
| `google/gemma-4-12b-qat` | Same family, smaller.                             |
| `ornith-1.5-35b-a3b`      | Best reasoning of the three ornith variants.      |
| `nvidia/nemotron-3-nano-4b` | Very fast, weaker planning.                    |

Any OpenAI-compatible local model works. Tested with LM Studio. Should
work with Ollama's OpenAI-compatible shim, vLLM, llama.cpp server, etc.

## System prompt

The bridge sends a fixed system prompt that constrains the model to
`THINK:` and `ACT:` format. You can edit the prompt in
`lmstudio-bridge/bridge.mjs` if you want different character or behavior.
Keep `THINK:` and `ACT:` prefixes; the parser relies on them.

## Observation format

Each tick the bridge sends the model:

```text
STATUS:
  ♥ Health: 20/20  Food: 20/20  Sat: 5
  ⊕ Position: -16.5, 70, 13.6  (overworld, unknown)
  ☀ Time: 7135 (afternoon)
  ✋ Holding: stripped_cherry_wood x1
  📦 Inventory (0 items):
  👁 Nearby entities: turtle (16.2m)
  🔍 Notable blocks:
     jungle_log at -21,72,14
     ...

CHAT:
  [last 5 chat messages, if any]

LAST ACTION: [previous turn's result, or "(none)"]
```

The model replies with:

```text
THINK: One short sentence about what the bot just noticed.
ACT: A single `mc` command, OR the literal word `NONE`.
```

`NONE` is treated as "I observed, but I have nothing to do right now."
Every other `ACT:` line is treated as a literal `mc` invocation.

## Why the response is so constrained

Small local models (3-9B) hallucinate when given freedom. Constraining
the response to `THINK:` + `ACT:` keeps the wire format simple, makes
the parser trivial, and lets you read the model's reasoning without
parsing JSON or structured output. The format also makes a malformed
response visible immediately.