# MinecraftAI System Upgrade Program Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the six-bot MinecraftAI stack more reliable, safer in-game, easier to operate remotely, and more observable—without replacing the vanilla server, exposing secrets, or introducing a large framework.

**Architecture:** Keep the present split between Mineflayer bot bodies, LM Studio bridge, minion controller, and Mission Control. Add deterministic safety/recovery layers beneath model decisions; add bounded telemetry and health summaries above them; evolve the custom terrain map rather than depending on a new server plugin. Every rollout must be independently reversible and restart only the component that changed.

**Tech Stack:** Node.js ES modules and `node:test`; Mineflayer plus already-installed pathfinder/collectblock plugins; vanilla HTML/CSS/JS; local LM Studio OpenAI-compatible API; Tailscale Serve; optional metrics using Node built-ins first, with `@prometheus-io/client` only if Prometheus scraping is actually adopted.

---

## Current facts and constraints

- Minecraft Java 26.2 uses protocol 776. The repository intentionally overlays 26.1 protocol data because full upstream 26.2 data remains incomplete; the bot processes are live but emit partial packet decoding warnings.
- Upstream 26.2 data and Mineflayer support remain open/unreleased; retain the fork rather than running `npm update` or replacing it with npm latest.[12][13][14].
- Related node-minecraft-protocol, chunk, and physics fixes are also pending, so they need independent fixture evidence rather than one bundled update.[16][17][18].
- The fork is missing two proposed 26.2 login-schema fields—`sessionId: UUID` in login-success and `onlineMode: bool` immediately before `enforcesSecureChat` in play-login. These are a narrow canary candidate for join/login reads only; they are not evidence that the observed `ExplosionParticleEntry` / `entity_metadata` errors are fixed.[11][12]
- Current errors include `PartialReadError` while decoding a `sonic_boom` particle/entity-metadata update. Bots stay connected, but this must be measured rather than dismissed.
- The current water-adjacent village caused repeated drowning. `minecraft/bot-server/server.js` already exposes a water hazard; `minecraft/minion-controller/minion-controller.mjs` already has dry-yard rallies, house protection, roles, queues, and a shared goal.
- Do not expose secrets, RCON credentials, arbitrary command execution, local paths, or world saves. Do not add public internet exposure; retain tailnet-only access.
- Mineflayer-pathfinder already supports configurable movements, composite goals, path updates, swimming, and entity avoidance.[10] It is already part of the bot server dependencies.
- `node:test` is stable and already in use by the regression test suite.[1]

## Non-goals

- No migration from vanilla Minecraft to Paper/Fabric in this program.
- No blind upgrade to upstream Mineflayer, minecraft-data, or prismarine packages.
- No full statemachine framework replacement: the existing controller tick/action lock model remains the single source of behavior coordination. Mineflayer-StateMachine is MIT and useful as a reference, but adding it now would create competing control systems.[7]
- No direct `prismarine-viewer` deployment against 26.2 until it passes a compatibility spike. Its documented supported versions currently end at 1.21.4.[4]
- No unrestricted RCON console, direct model-shell access, or automatic high-impact recovery actions.

## Release sequence and gates

1. **Stabilize protocol and gameplay safety first.** Do not make map/visual changes until packet and drowning measurements are captured.
2. **Then add observability and safe recovery controls.** Controls must reveal what they will restart and require a confirmation for state-changing actions.
3. **Then deepen coordination and logistics.** Use explicit claims/reservations and deterministic safe zones rather than longer model prompts.
4. **Then improve map/viewer quality.** Keep the existing real terrain endpoint as an always-available fallback.
5. **Only adopt a dependency after a pinned-version compatibility spike, license check, secret scan, and rollback plan.**

---

### Task 1: Establish a deterministic baseline and incident fixture set

**Objective:** Turn current live failures into reproducible, bounded regression inputs before modifying protocol or recovery code.

**Files:**
- Modify: `tests/minion-controller-regression.test.mjs`
- Create: `tests/fixtures/26.2/README.md`
- Create: `tests/fixtures/26.2/` packet fixture metadata only; raw captures must never contain player chat or private server data.
- Modify: `docs/TROUBLESHOOTING.md`

**Step 1: Add pure-function tests for safety state transitions.**

Test these cases without a live server:

- `isInWater` / submerged state produces exactly one dry-ground recovery action.
- Two water/death events in a rolling interval open a per-bot safety circuit breaker.
- A successful dry-ground status closes that breaker only after a cooldown.
- The current house safe radius and user-structure protection still filter all collection/build targets.
- A nonfatal classified protocol warning increments telemetry but does not mark a bot offline.

**Step 2: Create sanitized fixture requirements.**

Document the approved capture process: record only packet name, protocol version, timestamp offset, and payload bytes from a disposable test world; strip usernames, chat, UUIDs, IPs, inventories, and coordinates. Keep fixtures outside normal source history until manually reviewed.

**Step 3: Document baseline commands and expected output.**

Run:

```bash
node --test tests/minion-controller-regression.test.mjs
node --check minecraft/minion-controller/minion-controller.mjs
node --check minecraft/bot-server/server.js
bash scripts/secret-scan.sh
```

Expected: all tests pass; no syntax errors; secret scan passes.

**Step 4: Commit.**

```bash
git add tests docs/TROUBLESHOOTING.md
git commit -m "test: capture bot safety and protocol regression baseline"
```

---

### Task 2: Run a version-gated 26.2 protocol compatibility spike

**Objective:** Prove or reject the smallest known 26.2 login-schema correction on a canary, then capture fixtures for the separate particle/entity-metadata errors without touching live `node_modules`.

**Files:**
- Create: `mineflayer-26.2-fork/spikes/protocol-776/README.md`
- Create: `mineflayer-26.2-fork/spikes/protocol-776/decode-test.mjs`
- Modify: `mineflayer-26.2-fork/README.md` only after evidence confirms the result
- Modify later, conditionally: `mineflayer-26.2-fork/patches/` and `mineflayer-26.2-fork/install-26.2-fork.sh`

**Step 1: Record the complete canary baseline.**

Record fork/package SHAs, negotiated version, packet name/ID, sanitized hex payload, and the complete decoder stack trace. Preserve the existing installer backup. Do not modify the shared runtime tree or suppress `PartialReadError`.

**Step 2: Build an offline protocol-776 fixture decoder.**

The test must:

- Test only the two proposed login fields for protocol 776 / 26.2; preserve all earlier protocol behavior.
- Assert exact byte consumption for each sanitized fixture.
- Demonstrate the current parser's failure or trailing bytes first, then prove the candidate decodes login-success and play-login with no unread bytes.
- Capture separate `explosion` and `entity_metadata` fixtures. Do not infer an `ExplosionParticleEntry` layout from a `sonic_boom` warning: upstream's proposed particle and metadata definitions do not yet demonstrate a fix for that path.[12]

**Step 3: Verify against a disposable copied bot dependency tree.**

Do not patch a live `node_modules` tree or any running process. Copy the relevant package into a scratch dependency tree; apply only the two-field candidate from the upstream protocol diff; run the fixture decoder.[11]

**Step 4: Decision gate.**

- **If login fixtures prove the correction:** add a version-gated installer patch, document its exact upstream diff, and schedule a maintenance window for one canary bot only.
- **If they do not prove it:** leave the fork unchanged.
- **For particle/metadata fixtures:** update complete coupled registries only after a fixture proves the exact decoder change. Do not wholesale adopt open 26.2 data aliases: stale 26.1 registry aliases can silently map blocks/items/particles incorrectly.[12]

**Step 5: Canary rollout.**

Restart exactly one designated noncritical bot after saving its status/inventory/death baseline. Verify login, spawn, inventory names, movement, status endpoint, a terrain/block read, and 20 minutes without decoder-error increase. Roll back with the installer backup on any regression.

**Why this is first:** Mineflayer's 26.2 boilerplate and behavior fixes remain open.[14][15]

Separate chunk and physics fixes are also pending, so fixture-first selective adoption is safer than a package-wide update.[17][18]

---

### Task 3: Add deterministic dry-ground navigation and death circuit breakers

**Objective:** Prevent repeat drowning and unsafe wandering even when model outputs or background fallback work are imperfect.

**Files:**
- Modify: `minecraft/bot-server/server.js`
- Create: `minecraft/bot-server/lib/safety-policy.js`
- Create: `minecraft/bot-server/test/safety-policy.test.js`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `tests/minion-controller-regression.test.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`

**Step 1: Write failing unit tests.**

Add tests for:

- Water detected at current position or the immediate next path block leads to `stop` plus a bounded escape/rejoin task, not a repeated `collect`/`goto`.
- A bot with two drowning deaths inside a configured window becomes `safety_hold` and receives only its dry yard rally action.
- `safety_hold` blocks autonomous gather/build tasks but permits explicit human queue commands after confirmation.
- Water-adjacent tasks require an explicit `allowWater: true` property from Mission Control; models cannot manufacture this override via chat text.
- No safe-zone action targets inside the protected house radius.

**Step 2: Add a small explicit policy object.**

Use constants such as:

```js
const SAFETY = {
  waterExitRetries: 1,
  drowningWindowMs: 10 * 60 * 1000,
  drowningLimit: 2,
  holdCooldownMs: 5 * 60 * 1000,
  protectedRadius: 8,
};
```

Keep state per bot and in memory for this initial phase. Do not create a persistent database yet.

The pure safety-policy module must validate solid floor, air at feet/head, non-water/non-waterlogged position, player-approved build/depot zones, and a water-exclusion buffer. It must reject direct `dig`, `collect`, and `place` requests in protected zones, not merely advise the model.

**Step 3: Add path preflight hooks.**

Before `bg_goto`, `goto_near`, `collect`, and builder fallbacks:

- reject a known water block target unless the request explicitly carries `allowWater`;
- prefer an existing dry yard rally point;
- cap autonomous path distance while in recovery;
- record a structured reason code (`water_target`, `submerged`, `death_circuit_open`, `safe_zone_blocked`).

For routine village navigation, set `canDig=false`, `allowParkour=false`, high `liquidCost`, no infinite liquid drops, and break/place/step exclusions for water and protected areas. A separate opt-in movement profile is required for a human-approved fishing/boat/rescue order. Pathfinder exposes liquid/drop and exclusion hooks for this purpose.[19]

On `death`, immediately clear goal/digging/control state and mark recovery pending. Resume only after Mineflayer's post-respawn `spawn` event, a brief settle period, and validated dry/grounded status. Never auto-run `deathpoint` following a water death.[20]

**Step 4: Surface state in Mission Control.**

Add per-bot safety state, last hazard, last death cause, and a clear human-readable recovery reason to `/api/state`, fleet cards, activity feed, and map marker tooltip/readout. Add one safe button: **Return to dry yard**. Do not add a generic bypass button.

**Step 5: Live canary validation.**

- Queue a bot to a safe dry point and verify the task completes.
- Simulate status fixture indicating water; verify it pauses autonomous work and returns to its rally.
- Confirm all five controlled bots and HermesBot stay online.
- Observe death totals for at least 20 minutes; rollback the component if new drowning deaths continue.
- Confirm a model-issued `dig`, `collect`, or `place` cannot bypass the policy, and that only the affected bot is paused after the death threshold.

**Step 6: Commit.**

```bash
git add minecraft/bot-server/server.js minecraft/minion-controller/minion-controller.mjs webui tests
git commit -m "feat: add deterministic dry-ground bot safety recovery"
```

---

### Task 4: Introduce explicit team work orders and resource logistics

**Objective:** Replace implicit same-goal convergence with visible, bounded assignments that keep roles complementary.

**Files:**
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `minecraft/minion-controller/config.json`
- Modify: `webui/server.mjs`
- Modify: `webui/public/index.html`
- Modify: `webui/public/app.js`
- Modify: `tests/minion-controller-regression.test.mjs`

**Step 1: Define an in-memory work-order schema.**

```js
{
  id: "work_<timestamp>",
  title: "Gather oak logs outside dry-yard boundary",
  owner: "Steve",
  support: ["Moss"],
  state: "proposed|claimed|active|blocked|done|cancelled",
  priority: "safety|urgent|normal",
  safeZone: "yard|outside_house",
  requiredItems: [{ id: "oak_log", count: 12 }],
  createdBy: "web|controller|bot",
  createdAt: 0,
  updatedAt: 0,
  reason: "..."
}
```

Validate all item IDs against current bot data; validate all coordinates against house/water policy.

**Step 2: Write assignment and claim tests.**

- One primary owner per work order.
- Named human instructions target one bot; generic tasks create a proposal rather than triggering all bots to perform the same action.
- A dead/held/offline bot relinquishes its claim after a bounded timeout.
- A support role cannot duplicate a claimed gather action without a shortage signal.
- Builder tasks remain `proposed` until their footprint is confirmed in Mission Control.

**Step 3: Add controller endpoints.**

Add `GET /work-orders`, `POST /work-orders`, `POST /work-orders/:id/claim`, `POST /work-orders/:id/cancel`, and `POST /work-orders/:id/complete`. Keep all mutations local and validate all fields server-side.

**Step 4: Build a Mission Control work-order board.**

Add an accessible board with status chips, owner/support assignment, material check, safety reason, and audit event. Provide only curated templates initially:

- safe wood run;
- dry-yard farming;
- stone gathering outside house protection;
- supply return;
- scout/report;
- house-adjacent build proposal.

**Step 5: Add a small delivery workflow.**

Use existing inventory and chest APIs to support “bring item to staging chest” orders. The existing `mineflayer-collectblock` plugin supports higher-level collection and chest locations, making it a reference for bounded collection/storage behavior rather than a new dependency.[8]

**Step 6: Commit.**

```bash
git add minecraft/minion-controller webui tests
git commit -m "feat: coordinate bots with safe village work orders"
```

---

### Task 5: Add a bounded reliability and observability layer

**Objective:** Make failures actionable: classify them, retain a small local history, and display service/degraded state without log floods or secret leakage.

**Files:**
- Create: `shared/health.mjs`
- Create: `shared/ring-buffer.mjs`
- Create: `shared/event-journal.mjs`
- Create: `tests/health.test.mjs`
- Modify: `minecraft/bot-server/server.js`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `lmstudio-bridge/bridge.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`
- Modify: `docs/TROUBLESHOOTING.md`

**Step 1: Write classification tests.**

Classify events into:

- `protocol_decode_warning`;
- `model_terminated`;
- `model_unavailable`;
- `bot_disconnected`;
- `bot_reconnected`;
- `task_blocked`;
- `water_hazard`;
- `death`;
- `admin_action`.

Assert that messages are redacted/truncated, timestamps are monotonic, and the buffer drops oldest entries after a fixed cap.

**Step 2: Add reusable bounded ring buffers.**

Use a no-dependency module with a fixed event count and age cap. Include only safe operational metadata: component, bot name, category, level, duration, and sanitized detail. Never retain prompts, raw model outputs beyond the existing brief action summary, headers, request bodies, tokens, or RCON text.

Add a separately gitignored, bounded JSONL journal per component for state transitions, reconnects, rejected control actions, task outcomes, and operator restarts—not high-frequency ticks. Serialize writes through one promise queue, truncate/redact fields, rotate at a fixed byte budget, retain a small fixed number of files, and tolerate one malformed final line on startup. Node documents that concurrent `fs/promises` writes to one file are not synchronized.[21]

**Step 3: Add `/healthz` and `/readyz` semantics.**

- `healthz`: process event loop/API is serving.
- `readyz`: dependencies required for that component are reachable; distinguish degraded external model from bot/server status.
- `/api/operations/summary`: fan-in only short health, retry, error-rate, model, and bot state fields.

For Mineflayer bots, readiness requires a `spawn` event and must report reconnect attempt/next retry/last Mineflayer event. Add an explicit `error` listener alongside `kicked` and `end`; classify protocol errors as degraded/manual-intervention conditions, not an unbounded reconnect loop.[20]

Use timeouts and one-shot requests; do not add an uncontrolled polling loop.

**Step 4: Add a dashboard operations panel.**

Show:

- service up/degraded/offline state;
- connection age and last successful tick;
- per-category event totals for a selected window;
- last retry/backoff delay;
- last protocol error type;
- last five sanitized events;
- exact safe recovery recommendation, not an auto-restart.

**Step 5: Decide whether Prometheus is warranted.**

Phase A must expose JSON summaries only. If a real Prometheus server/dashboard will be operated, add a separate optional `/metrics` module using `@prometheus-io/client`; the project supports counters, gauges, histograms, summaries, and manual scrape responses without a web framework.[2] Pin the version and do not expose `/metrics` through public routes.

**Step 6: Commit.**

```bash
git add shared minecraft lmstudio-bridge webui tests docs
git commit -m "feat: add bounded health and operational telemetry"
```

---

### Task 6: Harden LM Studio model control and graceful degradation

**Objective:** Keep model selection useful without allowing a canceled model request to disturb the fleet.

**Files:**
- Modify: `lmstudio-bridge/bridge.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`
- Modify: `tests/lmstudio-model-policy.test.mjs`
- Modify: `docs/LM-STUDIO.md`

**Step 1: Add a model policy test suite.**

Test:

- selected IDs must be present in `/v1/models`;
- model changes preserve the last good model on discovery failure;
- a 400 terminated completion is logged as a transient event and cannot trigger restart loops;
- no more than one decision request per bot/body is in flight;
- model changes are rejected while an active request is pending unless explicitly queued;
- model metadata is never treated as authentication data.

**Step 2: Add timeout, cancellation, and circuit-breaker policy.**

Use `AbortSignal.timeout` and a small in-process policy object. A terminated/completion failure should back off to the next tick, record a classified event, and use deterministic controller fallback work where safe. Do not add a retry package unless a manual built-in implementation becomes demonstrably inadequate; `p-retry` is MIT and offers controlled exponential backoff/abort semantics, but it is optional.[3]

**Step 3: Add persisted-but-reviewed model profiles.**

Create a non-secret tracked example profile file such as `config/model-profiles.example.json`; keep live selection state in a gitignored local runtime file. Profiles can provide `fast`, `balanced`, and `deep-planning` settings with model ID, max tokens, temperature, and maximum concurrency. Never write credentials or LM Studio headers.

**Step 4: Add a model readiness panel.**

Show catalog freshness, active model per bot, current request age, terminated count, and an explicit **apply after current turn** indicator. Keep manual model selection, no automatic cross-model failover in the first release.

**Step 5: Commit.**

```bash
git add lmstudio-bridge minecraft/minion-controller webui tests docs config
git commit -m "feat: harden LM Studio model policy and degraded operation"
```

---

### Task 7: Evolve the map safely, with a compatibility spike before 3D

**Objective:** Deliver a richer navigation-quality map without tying the control plane to a third-party server plugin or unsupported 3D viewer.

**Files:**
- Modify: `webui/terrain.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/index.html`
- Modify: `webui/public/app.js`
- Modify: `webui/public/styles.css`
- Create: `tests/terrain.test.mjs`

**Step 1: Add terrain renderer tests.**

Use tiny synthetic Anvil/NBT fixtures or pure palette/height helper tests. Verify color resolution, water styling, elevation shading, boundaries, and safe fallback output when a region is unavailable.

**Step 2: Improve 2D map features first.**

Add, in this order:

- block/biome/elevation palette improvements;
- contour or hillshade overlay;
- chunk grid toggle;
- named landmarks and editable non-secret annotations;
- bot path trails with bounded length;
- work-order markers and safe-zone/water hazard overlays;
- selectable marker detail drawer;
- screenshot/export of only the rendered public map surface.

Do this in the existing canvas renderer, preserving the current fallback.

**Step 3: Evaluate Leaflet-style interaction only as a local UI module.**

Squaremap demonstrates useful ideas—live vanilla-style top-down navigation, player markers, and a Leaflet frontend—but it requires Paper/Fabric/NeoForge/Sponge server integration, which conflicts with the current vanilla-server constraint.[5] Do not migrate the server just for the map.

**Step 4: Run an optional 3D viewer spike in isolation.**

Do not mount it inside Mission Control yet. Test a separate local-only port/module against a copied world or one disposable bot. Prismarine Viewer can show bot/world views and draw path lines, but its documented compatibility stops at 1.21.4, so 26.2 texture/block correctness is not assumed.[4]

Acceptance criteria:

- no Mineflayer disconnects;
- no changed bot process memory/CPU budget beyond a predefined cap;
- correct terrain and block labels in a selected 26.2 village slice;
- viewer close unloads all handlers;
- Mission Control 2D map remains fully usable if the spike fails.

**Step 5: Commit 2D improvements separately from any 3D spike.**

```bash
git add webui tests
git commit -m "feat: enrich Mission Control terrain navigation map"
```

---

### Task 8: Create safe service lifecycle controls and release checks

**Objective:** Make the stack operable without broad process matches or surprise restarts.

**Files:**
- Create: `scripts/service-status.sh`
- Create: `scripts/restart-component.sh`
- Create: `tests/scripts.test.mjs` or shell smoke checks
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`
- Create: `.github/workflows/ci.yml`
- Modify: `docs/RUNNING.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Step 1: Add exact-component status scripts.**

Each command accepts exactly one allowlisted component: `mission-control`, `bridge`, `controller`, or a single named bot. It must inspect PID, listener, `healthz`, `readyz`, and dependency reachability. It must never use `pkill`, `killall`, broad regular expressions, firewall changes, or network configuration changes.

**Step 2: Add exact-component graceful restart scripts.**

Require a `--confirm` flag and perform:

1. preflight health snapshot;
2. exact PID discovery from expected port/process identity;
3. graceful `SIGTERM` only to that PID;
4. bounded wait;
5. relaunch using the canonical command;
6. exact endpoint/readiness verification;
7. human-readable rollback advice if verification fails.

No control for Minecraft server restart in the first release; that remains manual.

**Step 3: Add dashboard recovery guidance, not default auto-remediation.**

Show the recommended component and reason. The UI must make the user acknowledge scope before calling an allowlisted recovery endpoint. Do not implement one-click fleet restart.

**Step 4: Add CI.**

On push/pull request:

```bash
node --check webui/server.mjs
node --check webui/public/app.js
node --check lmstudio-bridge/bridge.mjs
node --check minecraft/minion-controller/minion-controller.mjs
node --test tests/minion-controller-regression.test.mjs
bash scripts/secret-scan.sh
git diff --check
```

Use the existing Node test runner rather than adding Jest/Vitest.[1]

**Step 5: Commit.**

```bash
git add scripts webui tests .github docs
git commit -m "feat: add safe component lifecycle checks and CI"
```

---

### Task 9: Conduct controlled integration acceptance testing

**Objective:** Prove the upgrade program works in the real stack before declaring it complete.

**Files:**
- Create: `docs/ACCEPTANCE-TEST.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Step 1: Run source and unit validation.**

Run all Node checks, all `node --test` suites, `git diff --check`, and secret scan.

**Step 2: Test components one at a time.**

- Mission Control: state, models, terrain, activity, work orders, responsive page assets.
- Controller: goal, team radio, claim lifecycle, safety hold.
- Bridge: healthy request, terminated request classification, no restart loop.
- Each bot: status, inventory, queue, safe rally, path preflight.

**Step 3: Run a 30-minute supervised gameplay soak.**

Success criteria:

- 6/6 bots remain reachable;
- no repeated drowning/death circuit opens without a clear dashboard reason;
- no decoder error causes a disconnect/restart cascade;
- one complete work order succeeds without duplicate claims;
- no player-built block is targeted by autonomous collection/build action;
- dashboard and Tailscale UI remain usable at phone and desktop breakpoints.

**Step 4: Record outcomes and decide rollout.**

- If all gates pass, tag a release and publish a concise changelog.
- If a canary fails, roll back only the changed component using its backup/previous commit; preserve the incident fixture and event summary for the next iteration.

---

## Prioritized roadmap

1. **P0 — Do now:** Task 1 baseline; Task 2 protocol spike; Task 3 dry-ground/death circuit breaker.
2. **P1 — Next:** Task 5 bounded observability; Task 6 LM Studio graceful degradation; Task 8 safe lifecycle/CI.
3. **P2 — Coordination:** Task 4 explicit work orders and logistics.
4. **P3 — Experience:** Task 7 map quality and isolated 3D compatibility spike.
5. **P4 — Release:** Task 9 supervised soak, documentation, release tag.

## Risks and tradeoffs

- **Protocol patch risk:** protocol 776 remains custom/upstream-incomplete. Never deploy a decoder patch from an issue report directly to all bots; fixture proof and one-bot canary are mandatory.[9]
- **Safety policy risk:** overly conservative water avoidance can stall farming/fishing. Use an explicit reviewed `allowWater` flag rather than removing those capabilities.
- **Coordination risk:** a full new behavior/state-machine framework would duplicate controller ownership and raise regression risk. Keep narrowly scoped deterministic guards outside the model loop.
- **Metrics risk:** Prometheus adds operational overhead. Start with JSON/ring-buffer observability; adopt the Apache-2.0 client only if a real scraper and retention policy are approved.[2]
- **Map risk:** squaremap and Pl3xMap demonstrate mature live-map features, but their integration requires non-vanilla server platforms. Treat them as design references, not drop-in dependencies.[5][6]
- **3D viewer risk:** Prismarine Viewer is MIT and supports paths/first-person views, but its stated support stops before current 26.2. Keep any experiment separate from bot control until a compatibility spike passes.[4]

## Plan review checklist

- [x] No running service changes were made while planning.
- [x] Plan preserves vanilla server, local credentials, Tailscale-only access, and player structure protection.
- [x] Every code-producing task includes explicit tests and a rollback/verification path.
- [x] Dependencies are optional and license-reviewed before adoption.
- [x] Protocol, drowning safety, and service observability precede UI polish.

## Sources

[1] https://nodejs.org/api/test.html
[2] https://github.com/siimon/prom-client
[3] https://github.com/sindresorhus/p-retry
[4] https://github.com/PrismarineJS/prismarine-viewer
[5] https://github.com/jpenilla/squaremap
[6] https://modrinth.com/plugin/pl3xmap
[7] https://github.com/PrismarineJS/mineflayer-statemachine
[8] https://github.com/PrismarineJS/mineflayer-collectblock
[9] https://github.com/PrismarineJS/mineflayer/issues/3952
[10] https://github.com/PrismarineJS/mineflayer-pathfinder
[11] https://github.com/PrismarineJS/minecraft-data/pull/1216.diff
[12] https://github.com/PrismarineJS/minecraft-data/pull/1219
[13] https://github.com/PrismarineJS/minecraft-data/issues/1197
[14] https://github.com/PrismarineJS/mineflayer/pull/3926
[15] https://github.com/PrismarineJS/mineflayer/pull/3958
[16] https://github.com/PrismarineJS/node-minecraft-protocol/pull/1496
[17] https://github.com/PrismarineJS/prismarine-chunk/pull/331
[18] https://github.com/PrismarineJS/prismarine-physics/pull/138
[19] https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md
[20] https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
[21] https://nodejs.org/api/fs.html
