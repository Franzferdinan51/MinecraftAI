# Hermes overseer boundary (`hermes-overseer/`)

DuckBot may use Hermes planning, memory, research, and multi-agent
strengths — but only through this narrow, validated boundary. Hermes is
treated as an external senior specialist: bounded redacted requests go
out, proposal-only responses come back, and everything re-enters the
game stack as a review item or authority-gateway proposal.

## Files

| File | Job |
|---|---|
| `overseer-requests.schema.json` | v1 request shape: goal, manifest, memories, receipts, safety summary, task board, question, token/time budget. |
| `overseer-response.schema.json` | v1 response shape: `schemaVersion: 1`, up to 12 proposals, research notes, skill ideas. No commands. |
| `overseer-boundary.mjs` | `validateOverseerRequest()` (redaction enforcement) and `validateOverseerResponse()` (schema + tier + raw-command bans). |
| `minecraft-capability-contract.md` | The four Hermes powers and the tier rules the overseer profile must follow. |

## What never crosses

Out: credentials, server config, RCON secrets, raw/unredacted chat,
files, shell instructions. In: unknown capabilities, tier changes, raw
`mc`/RCON/shell strings, oversized batches, wrong schema versions.

## Dedicated profile (manual setup, after contracts exist)

1. Create a `hermescraft-overseer` Hermes profile/Bot.
2. Give it the capability contract below plus planning and grounded-research skills only.
3. Enable **no** terminal, filesystem-write, credential, system-admin, browser-automation, or write-capable MCP tools.
4. No shared live Minecraft/RCON secrets in its config.

Transport (local adapter or read-mostly MCP wrapper) is a later step,
chosen after a local proof-of-concept. No web-accessible Hermes endpoint.
