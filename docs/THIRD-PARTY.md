# Third-party inspirations

Ideas cherry-picked from open-source projects (all MIT/Apache-2.0, design
inspiration or direct dependency — never copied code without a compatible
license). Verified against our stack before adoption.

## Adopted

### Furnace workflow — `minecraft-mcp-server` (Apache-2.0)
- Source: https://github.com/yuniko-software/minecraft-mcp-server (716 stars)
- Idea: the `smelt-item` tool — put input + auto-selected fuel in a nearby
  furnace, wait, take output. Our bot API (`mc smelt`) already worked this
  way, but the minion controller never issued it: bots hoarded raw pork and
  raw iron forever.
- What we took: `furnaceAction()` in
  `minecraft/minion-controller/minion-controller.mjs` — cook raw food when
  hungry (or when no cooked food is stocked), smelt ores otherwise, and have
  miners/builders with 8+ cobblestone craft a furnace at a nearby crafting
  table. Covered by `tests/minion-controller-regression.test.mjs`.
- Verified: `node --check`, regression suite, live `mc smelt` error path
  (`No furnace within 4 blocks` — clean failure, no hang).

### Already-integrated PrismarineJS plugins (MIT)
Our bot server already runs these — no change needed, listed so we don't
re-invent them:
- `mineflayer-pathfinder` — navigation (`mc goto_near`, `mc bg_goto`).
- `mineflayer-collectblock` — `mc collect` with tool handling.
- `mineflayer-armor-manager` — auto-equips best armor on pickup.
- `mineflayer-auto-eat` — bot-level eating safety net under the
  controller's `survivalAction()`.
- `mineflayer-pvp` — installed but **disabled**: its deprecated physicTick
  event breaks pathfinder. Combat uses the built-in `mc fight` instead.

## Evaluated, not adopted

### Voyager / MineDojo skill library (research project)
- Source: https://github.com/MineDojo/Voyager
- Idea: lifelong skill library — successful procedures are stored as reusable
  code and retrieved for future tasks; curriculum stages (wood → stone →
  iron → …).
- Why not: our roles + deterministic fallbacks already encode the early
  curriculum, and auto-growing prompts risk unbounded context on the small
  local model. Revisit if bots stall at the iron stage.

### `mineflayer-statemachine` (MIT)
- Source: https://github.com/PrismarineJS/mineflayer-statemachine
- Idea: nested state machines for complex behaviors.
- Why not: the controller's tick loop + `action_busy` locks + background
  work already give us concurrency without a second state system. Adding one
  would be two sources of truth.

### `prismarine-viewer` (MIT)
- Idea: live 3D web map of the world.
- Why not: heavy browser dependency for an operator nicety; the ASCII scene
  map in bot status already feeds the model. Revisit as a dashboard extra.

### `mineflayer-bloodhound` (MIT)
- Idea: attribute damage to a responsible entity/player.
- Why not: the bot server already tracks `combatStats` + `deathLog` with
  positions, which covers our fight/flee decisions.
