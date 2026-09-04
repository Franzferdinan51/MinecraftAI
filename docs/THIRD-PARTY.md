# Third-party inspirations

Ideas cherry-picked from open-source projects (all MIT/Apache-2.0, design
inspiration or direct dependency — never copied code without a compatible
license). Verified against our stack before adoption.

## Adopted

### HermesCraft bot bodies + agent pattern — `bigph00t/hermescraft` (MIT)
- Source: https://github.com/bigph00t/hermescraft
- Idea: the whole body-driver layer — one Mineflayer HTTP bot server per
  character (`bot/server.js`), the `mc` CLI, per-character Hermes brains
  (own `HERMES_HOME`, memory, SOUL/prompt), fair-play perception
  (`mc scene`/`map`/`look`, line-of-sight filtering, directional sound
  hints), social routing (public chat, `whisper` via native `/msg`,
  `overheardLog` proximity filter), background tasks (`bg_goto`,
  `bg_collect`), and the Landfolk behavior rules (3-observation action
  rule, inventory-first, SUBMERGED response, 1-sentence chat, `mc fill`
  building workflow) plus the five `skills/minecraft-*.md` guides.
- Vendored in-repo: [`minecraft/hermescraft/`](../minecraft/hermescraft/)
  carries the fleet-adapted core with per-file MIT attribution —
  `landfolk/*.md` (5 upstream cards player-neutralized + our
  `duckbot.md` overseer), `SOUL-landfolk.md` (shared contract,
  machine-enforced twin: `minecraft/intelligence/contracts.mjs`),
  `skills/minecraft-*.md` (all five guides). Upstream-only parts
  deliberately not taken: experimental arena/battle, civilization
  cast, LAN batch launchers.
- What we took: the architecture verbatim (our `minecraft/start-*.sh`
  launchers assume a hermescraft checkout at `$HOME/games/hermescraft`);
  the Landfolk rules synthesized into all six fleet SOUL.md contracts;
  the five skill guides installed per-profile under `skills/gaming/`
  (role-matched: building→Steve/Reed, farming→Moss, combat→Flint/Ember,
  survival+navigation+companion→all, civilization+bridge→overseer).
- Where we are a superset (kept, not upstreamed): 9 extra bot actions
  (`breed`, `door`, `fish`, `harvest`, `inspect`, `milk`, `shear`, `sow`,
  `till`), the 26.2 protocol fork (`mineflayer-26.2-fork/`), and our own
  layers upstream doesn't have (LM Studio bridge, minion controller,
  `minecraft/intelligence/` safety pipeline, Mission Control UI).
- Verified: function/CLI diff both directions (upstream-only: none;
  local-only: the 9 actions above), `lib/` identical, skill bodies
  ~identical (11–12 diff lines of frontmatter), every skill-referenced
  `mc` command exists live, agent smoke tests per profile.
- License: MIT — compatible. Attribution kept here and in
  `minecraft/start-bot-server.sh`.

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
