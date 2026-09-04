# HermesCraft core (vendored, attributed)

This directory vendors the HermesCraft heart of the fleet — landfolk
character cards, the shared behavior contract, and the five Minecraft
skill guides — adapted from
[bigph00t/hermescraft](https://github.com/bigph00t/hermescraft)
(MIT, (c) 2026 bigph00t). Full provenance is in
[`docs/THIRD-PARTY.md`](../../docs/THIRD-PARTY.md).

## What's here

- `landfolk/` — one character card per agent: `steve`, `reed`, `moss`,
  `flint`, `ember` (fleet adaptations of upstream
  `prompts/landfolk/*.md`: player-neutral, DuckBot overseer
  coordination, body ports, safety footer) plus `duckbot.md` (our
  overseer, no upstream equivalent).
- `SOUL-landfolk.md` — the shared behavior contract in human-readable
  form (action rule, inventory-first, SUBMERGED response, chat style).
  The machine-enforced version is
  [`minecraft/intelligence/contracts.mjs`](../intelligence/contracts.mjs);
  each agent's live profile SOUL.md carries the same rules.
- `skills/` — the five `minecraft-*.md` skill guides (building, combat,
  farming, navigation, survival), installed per-profile role-matched:
  building→Steve/Reed, farming→Moss, combat→Flint/Ember,
  survival+navigation→all.

## How it maps to upstream

| Upstream (`bigph00t/hermescraft`) | Here |
| -------------------------------- | ---- |
| `prompts/landfolk/{steve,reed,moss,flint,ember}.md` | `landfolk/*.md` (adapted, attributed) |
| `SOUL-landfolk.md` | `SOUL-landfolk.md` (rewritten for fleet) |
| `skills/minecraft-*.md` | `skills/*.md` (adapted, attributed) |
| `bot/server.js`, `bot/lib/`, `bin/mc` | `minecraft/bot-server/` (tracked superset: +9 actions) |
| `scripts/run-landfolk-bots.sh` | `minecraft/start-minion-controller.sh` + `start-bot-server.sh` |

Deliberately not taken from upstream: experimental arena/battle,
civilization cast, LAN batch launchers.

## Running it

The live bodies run from a hermescraft checkout at
`$HOME/games/hermescraft` (see root README "Files outside the repo"):
each agent's profile (own `HERMES_HOME`, memory, SOUL) drives its body
over HTTP. This directory is the versioned source of what those
profiles carry.
