# HermesCraft Overseer and Minion Powers Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn HermesBot into a capable, supervised HermesCraft overseer and give every Minecraft minion role-specific planning, memory, learning, coordination, and action powers—while retaining deterministic safety gates, player-build protection, local-only credentials, and a vanilla Minecraft server.

**Architecture:** Add a small, explicit intelligence layer between the current controller/dashboard and Minecraft action APIs. HermesBot becomes the senior planner/researcher through a narrow local capability gateway; minions receive constrained role skills and can request specialist assistance. Models propose typed plans or actions; deterministic code validates permissions, safety, task leases, resource availability, budgets, and post-action evidence before anything enters a bot queue.

**Tech Stack:** Existing Node.js ES modules, `node:test`, Mission Control, Minion Controller, bot-server `mc` API, LM Studio OpenAI-compatible API, optional local Hermes profile/Bot integration, local JSONL files in gitignored runtime storage. No database, no new frontend framework, no direct shell or filesystem access from Minecraft bots.

---

## What “powers” mean

A power is an explicit, named, testable capability—not unrestricted access to the computer.

| Character | Primary powers | May never do automatically |
|---|---|---|
| **HermesBot** | Overseer planning, incident triage, research requests, task-board design, skill recommendation, team-memory synthesis, audited work-order proposals | shell commands, arbitrary Hermes tools, credentials, RCON console, destructive/admin Minecraft actions |
| **Steve** | Foreman: accepts human intent, decomposes safe construction tasks, holds build claims, requests materials, verifies completed work | build/dig inside protected/player zones or unapproved designs |
| **Reed** | Builder: reads approved build cards, checks materials/area, builds only bounded approved patterns, reports block counts and completion evidence | freeform construction or modifying existing player structures |
| **Moss** | Food/logistics: farm/ranch loop, food triage, depot accounting, delivery coordination, seed/food requests | drain unapproved chests or work in water-danger state |
| **Flint** | Miner/supply scout: safe quarry tasks, ore/stone reports, tool/fuel requests, return-to-depot workflow | mine near player structures, unsafe cave/water travel, unbounded exploration |
| **Ember** | Scout/guardian: hazard survey, dry-route marking, player sighting relay, threat alerts, defensive actions under health limits | aggressive combat at low health, risky pursuit, entering protected areas |

Every minion receives the same foundational powers: shared task board, in-game team-radio protocol, role skill cards, team memory retrieval, work-order claims, verified completion reports, safety recovery, and the ability to ask HermesBot for help. HermesBot has broader **planning** powers, not broader raw Minecraft or system authority.

## Current reality and constraints

- The Minion Controller currently runs independent local model loops, with one free-form `THINK:`/`ACT:` output per minion and a deterministic fallback loop.
- Mission Control’s `/api/ask` currently uses a model response plus a fenced JSON order block. This is useful but too fragile to be the long-term authority boundary.
- Hermes Agent supports named Bots/profiles with isolated skills and memory, routines, group chats, and direct bot-to-bot messaging; its capabilities can be selectively enabled per bot/profile.[6]
- Hermes exposes persistent memory, reusable skills, MCP integrations, model/provider selection, scheduling, and web research as supported product surfaces.[5]
- LM Studio supports JSON-schema constrained output and tool-call requests through its local OpenAI-compatible API. The application must still execute and validate requested tools itself.[1][2]
- The user permits parallel model calls, but safety and action execution must stay serialized per individual bot.
- Preserve: vanilla server; tailnet-only Mission Control; player structures; dry-ground safety; secrets outside the repo; no arbitrary RCON; no broad restarts; no runtime world save/log commits.

## Non-goals

- Do not grant Minecraft models unrestricted terminal, filesystem, browser, network, Hermes config, credential, or plugin access.
- Do not automatically create or edit Hermes global configuration, profiles, skills, MCP registration, or cron schedules from an in-game request.
- Do not instantiate five full-power Hermes processes by default. That is expensive, less predictable, and duplicates sensitive capabilities.
- Do not add a framework or database before the typed in-process implementation proves insufficient.
- Do not replace local deterministic survival behavior with an LLM.

## Capability tiers and approval policy

### Tier 0 — always-on deterministic safety
- Hunger, health, hostile proximity, stuck movement, water/death recovery, protected-area checks, exact action queue serialization, retry caps, and connection status.
- No model can override Tier 0.

### Tier 1 — autonomous role powers
- Minions may execute safe, allowlisted Minecraft work orders inside their role and approved area/material/budget limits.
- Examples: harvest a known field, gather a bounded stone amount outside protected zones, deposit approved surplus into an approved depot, return to a verified dry rally point, report threats.

### Tier 2 — overseer-proposed actions requiring deterministic authorization
- HermesBot or a minion can propose multi-step plans, build cards, resource allocations, and team work boards.
- Code verifies schema, target bot role, task lease, resource availability, area approval, action count, deadline, safety state, and idempotency key before dispatch.

### Tier 3 — player-approved actions
- New build footprints, changing village goals, changing model profiles, adding/changing a skill card, a new depot coordinate, water-enabled mission, any server-administration operation, any action touching a protected boundary, or a new Hermes integration.
- Mission Control must present a plain-language preview and require an explicit confirmation. In-game chat alone can request but cannot approve Tier 3.

---

### Task 1: Create the intelligence contracts and capability manifest

**Objective:** Establish one typed source of truth for bot powers, action permissions, model output, work orders, and verification evidence.

**Files:**
- Create: `minecraft/intelligence/contracts.mjs`
- Create: `minecraft/intelligence/capabilities.mjs`
- Create: `minecraft/intelligence/skill-cards.mjs`
- Create: `minecraft/intelligence/README.md`
- Create: `tests/intelligence-contracts.test.mjs`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RUNNING.md`

**Step 1: Write failing contract tests.**

Cover:
- unknown bot, unknown capability, unknown action, unknown role, and unknown schema version are rejected;
- a Builder may request `build_card.execute` but not `server.admin`;
- an Overseer may propose `work_order.create` but cannot directly return a raw `mc` command;
- all Tier 3 actions require a `requiresApproval: true` flag and a human approval record;
- an action proposal requires `id`, `bot`, `capability`, `args`, `reason`, `expectedEvidence`, `riskTier`, and `idempotencyKey`;
- schema parser rejects extra fields, wrong types, out-of-range coordinates, oversized strings, duplicate work-order IDs, and missing evidence.

**Step 2: Define capability entries, not prose permissions.**

Use data shaped like:

```js
export const CAPABILITIES = {
  'team.read': { tier: 1, roles: ['all'], mode: 'read' },
  'team.request_help': { tier: 1, roles: ['all'], mode: 'propose' },
  'work_order.claim': { tier: 1, roles: ['all'], mode: 'execute' },
  'build_card.propose': { tier: 2, roles: ['foreman', 'overseer'], mode: 'propose' },
  'build_card.execute': { tier: 1, roles: ['builder'], mode: 'execute' },
  'depot.transfer': { tier: 1, roles: ['farmer', 'miner', 'builder'], mode: 'execute' },
  'hazard.report': { tier: 1, roles: ['scout', 'all'], mode: 'execute' },
  'hermes.research_request': { tier: 2, roles: ['overseer'], mode: 'propose' },
  'skill.propose': { tier: 2, roles: ['overseer', 'foreman'], mode: 'propose' },
};
```

No capability represents shell access, arbitrary HTTP, arbitrary MCP tool invocation, arbitrary file read/write, credentials, or raw RCON.

**Step 3: Define role skill cards.**

A skill card is a short, versioned deterministic procedure with: prerequisites, allowed action templates, max action count, expected evidence, failure exits, cooldown, and protected-zone policy. Start with eight cards only:

1. `safe-regroup` — every bot;
2. `hazard-survey` — Ember;
3. `safe-quarry-batch` — Flint;
4. `farm-food-loop` — Moss;
5. `depot-delivery` — Moss/Flint/Reed;
6. `material-preflight` — Steve/Reed;
7. `small-approved-build` — Reed;
8. `team-help-request` — every bot.

**Step 4: Run tests.**

```bash
node --test tests/intelligence-contracts.test.mjs
node --check minecraft/intelligence/contracts.mjs
node --check minecraft/intelligence/capabilities.mjs
node --check minecraft/intelligence/skill-cards.mjs
```

Expected: all tests pass.

**Step 5: Commit.**

```bash
git add minecraft/intelligence tests docs
git commit -m "feat: define HermesCraft intelligence capability contracts"
```

---

### Task 2: Replace free-form action parsing with structured proposal envelopes

**Objective:** Make the model propose valid, inspectable data rather than relying on `THINK:`/`ACT:` text parsing for overseer and upgraded minion flows.

**Files:**
- Create: `minecraft/intelligence/model-protocol.mjs`
- Create: `tests/model-protocol.test.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `lmstudio-bridge/bridge.mjs`
- Modify: `docs/LM-STUDIO.md`

**Step 1: Write failing parser and fallback tests.**

Verify:
- valid JSON proposal becomes a typed candidate;
- malformed JSON, absent output, unsupported schema response, or invalid enum produces no action and uses existing deterministic survival/fallback logic;
- a valid proposal does not bypass the capability gateway;
- no raw `mc` command string becomes executable merely because a model emitted it;
- timeout/cancellation does not create a partial action;
- action proposals preserve a short player-facing explanation but never persist model chain-of-thought.

**Step 2: Define the minimal schema.**

```json
{
  "schemaVersion": 1,
  "summary": "I will ask Flint to collect stone for the approved path.",
  "intent": "advance_village_goal",
  "proposals": [
    {
      "id": "proposal-uuid",
      "bot": "Flint",
      "capability": "skill.run",
      "skill": "safe-quarry-batch",
      "args": {"block": "stone", "count": 12, "area": "quarry-a"},
      "reason": "Reed's approved build card needs stone.",
      "expectedEvidence": ["inventory_delta", "task_complete"],
      "riskTier": 1,
      "idempotencyKey": "goal-version:task:flint:stone-12"
    }
  ],
  "helpRequests": [],
  "memoryCandidates": []
}
```

Use `response_format` JSON schema where the currently selected LM Studio model supports it, because LM Studio documents JSON-schema output at `/v1/chat/completions`.[1] Maintain a robust parser/validator and the existing fallback path because valid schema shape does not guarantee a truthful or safe proposal.

**Step 3: Gradual rollout modes.**

Add `INTELLIGENCE_MODE=observe|shadow|canary|active`:
- `observe`: build context and validate proposals, execute nothing;
- `shadow`: compare structured proposal against current controller decision, execute current behavior only;
- `canary`: structured proposals affect exactly one named bot and only Tier 1 skill cards;
- `active`: all minions may use approved Tier 1 cards; Tier 2/3 rules remain unchanged.

Default to `observe` until live evidence validates a canary.

**Step 4: Preserve current compatibility.**

Keep legacy prompt parsing behind an explicit feature flag during migration. Do not convert HermesBot and all five minions in one restart.

**Step 5: Test and commit.**

```bash
node --test tests/model-protocol.test.mjs tests/minion-controller-regression.test.mjs
node --check minecraft/minion-controller/minion-controller.mjs
node --check lmstudio-bridge/bridge.mjs
git add minecraft/intelligence minecraft/minion-controller lmstudio-bridge tests docs
git commit -m "feat: add structured overseer and minion action proposals"
```

---

### Task 3: Build the deterministic authority gateway

**Objective:** Centralize capability checks, protected-area policy, work leases, budgets, idempotency, and post-action verification before bot queues receive work.

**Files:**
- Create: `minecraft/intelligence/authority-gateway.mjs`
- Create: `minecraft/intelligence/action-adapters.mjs`
- Create: `tests/authority-gateway.test.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `minecraft/bot-server/server.js`
- Modify: `webui/server.mjs`

**Step 1: Write failing authorization tests.**

Test:
- rejected role/capability combination never makes an HTTP action call;
- Tier 3 action without human approval is rejected;
- safety recovery state rejects unrelated movement/building;
- minion cannot execute an action while another action is active;
- duplicate idempotency key returns the original receipt, not another queue entry;
- action/skill limits reject counts, distances, and areas outside the card;
- protected zones block `dig`, `collect`, `place`, and pathfinder breaking in every path;
- cancelled/expired lease blocks dispatch;
- observed evidence mismatch leads to `needs_review`, not a fabricated completion.

**Step 2: Add the gateway pipeline.**

```text
proposal
  → schema validation
  → role/capability check
  → safety + protected-area check
  → work-order/area/depot lease check
  → action budget + idempotency check
  → approved bot API adapter
  → bounded status/evidence verification
  → receipt + team-radio update + memory candidate
```

The only code allowed to call a state-changing bot endpoint for intelligence-generated work is `action-adapters.mjs` through the authority gateway.

**Step 3: Provide adapters only for safe primitives.**

Initial adapter allowlist:
- safe `goto_near`/`bg_goto` to validated dry destinations;
- `collect` outside protected zones and bounded by card limits;
- `craft`, `smelt`, `eat`, `sleep_bed`;
- `till`, `sow`, `harvest`, `breed`, `shear`, `milk` in approved farm zones;
- `deposit`/`withdraw` only at approved depot coordinates and under a chest lease;
- `chat` through the existing rate-limited team radio;
- `task/cancel` and dry-yard recovery.

Do not initially authorize raw `dig`, generic `place`, `place_fill`, arbitrary follow, deathpoint recovery, RCON, `/api/admin`, or queue clearing through model-originated plans.

**Step 4: Add receipts and evidence.**

A receipt records actor, approved capability, sanitized args, precondition digest, start/end, result state, inventory/position delta where relevant, verifier result, and safe error class. It excludes model prompt, reasoning, chat/private content, headers, credentials, raw RCON output, and machine paths.

**Step 5: Commit.**

```bash
node --test tests/authority-gateway.test.mjs tests/intelligence-contracts.test.mjs
node --check minecraft/intelligence/authority-gateway.mjs
node --check minecraft/intelligence/action-adapters.mjs
git add minecraft/intelligence minecraft/bot-server minecraft/minion-controller webui tests
git commit -m "feat: gate AI and HermesCraft powers through verified authority"
```

---

### Task 4: Give every minion a personal skillbook and shared learned memory

**Objective:** Let minions improve from verified Minecraft outcomes without inventing unsafe or unreviewed behavior.

**Files:**
- Create: `minecraft/intelligence/memory-store.mjs`
- Create: `minecraft/intelligence/learning-policy.mjs`
- Create: `minecraft/intelligence/role-skillbook.mjs`
- Create: `tests/memory-store.test.mjs`
- Create: `tests/learning-policy.test.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`
- Modify: `.gitignore`

**Step 1: Define three memory scopes.**

1. **Episodic:** recent task results, hazards, supply changes, verified locations; bounded and expires.
2. **Semantic:** durable facts such as approved depots, validated rally pads, approved farms/quarries, and known player-protected zones.
3. **Procedural:** role skill cards only after verified repeated success and player review.

Store runtime data under a gitignored configurable directory such as `HERMESCRAFT_RUNTIME_DIR`; do not write world saves, raw prompts, credentials, private player chat, or unbounded chat logs.

**Step 2: Add memory acceptance rules.**

A candidate can enter episodic memory only if produced by a trusted observation or verified receipt. Semantic promotion requires corroboration or player confirmation. Procedural promotion requires:
- at least three verified successful uses;
- no protected-area/safety violation;
- a reproducible card definition;
- a visible Mission Control review record;
- explicit player approval before becoming active for the fleet.

**Step 3: Add retrieval quotas.**

Each model context gets at most: current goal, own active work order, own skill card, up to five relevant verified memories, up to three recent team summaries, and a redacted last action. This keeps local models focused and avoids teaching them stale failures.

**Step 4: Add learning review UX.**

Mission Control should show:
- what was learned;
- source receipt IDs/count;
- scope, expiry, and confidence;
- proposed new/changed skill card diff;
- **Approve**, **Reject**, and **Expire** controls.

Approval is Tier 3. No model can self-promote a lesson into an active power.

**Step 5: Test and commit.**

```bash
node --test tests/memory-store.test.mjs tests/learning-policy.test.mjs
node --check minecraft/intelligence/memory-store.mjs
node --check minecraft/intelligence/learning-policy.mjs
git add minecraft/intelligence minecraft/minion-controller webui tests .gitignore
git commit -m "feat: add reviewed role learning and shared team memory"
```

---

### Task 5: Create the HermesBot overseer integration boundary

**Objective:** Allow HermesBot to use selected Hermes planning, memory, skill, research, and multi-agent strengths without passing broad Hermes tool access into Minecraft.

**Files:**
- Create: `hermes-overseer/README.md`
- Create: `hermes-overseer/overseer-requests.schema.json`
- Create: `hermes-overseer/overseer-response.schema.json`
- Create: `hermes-overseer/minecraft-capability-contract.md`
- Create: `tests/overseer-contract.test.mjs`
- Modify: `webui/server.mjs`
- Modify: `minecraft/intelligence/authority-gateway.mjs`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RUNNING.md`

**Step 1: Treat Hermes as an external senior specialist.**

The game stack sends only a bounded, redacted request package:
- village goal and goal version;
- current role/capability manifest;
- approved semantic memories and bounded recent receipts;
- health/safety/degraded summaries;
- task-board/lease summary;
- player question or a research/planning request;
- a maximum token/time/tool budget.

It never sends raw server configuration, credentials, secrets, arbitrary files, unredacted player chat, or open-ended command execution instructions.

**Step 2: Define the four initial Hermes powers.**

1. `hermes.plan_workboard` — turn a player goal into bounded proposed work orders.
2. `hermes.review_incident` — analyze a redacted failure/hazard summary and recommend recovery/next evidence.
3. `hermes.research_recipe_or_mechanic` — research a Minecraft mechanic or public upstream compatibility question, returning links, uncertainty, and no direct action.
4. `hermes.propose_skill` — convert repeated verified outcomes into a reviewed skill-card proposal.

Hermes Agent’s profile/Bot model supports isolated role, model, skills, and memory, enabling a dedicated overseer profile whose enabled capabilities are deliberately selected.[6]

**Step 3: Use a dedicated constrained Hermes profile.**

Create this manually only after the contract/tests exist:
- `hermescraft-overseer` profile/Bot;
- dedicated SOUL and project rules describing the Minecraft authority tiers;
- skills limited initially to planning, grounded research, and the Minecraft capability contract;
- no terminal toolset, no unrestricted filesystem, no credential tools, no system administration, no browser automation, and no write-capable MCP tools;
- read-only research tools only if explicitly enabled;
- no shared live Minecraft/RCON secret configuration.

Hermes Bots can have independently selected role, model, skills, memory, and tool/MCP enablement; use that selectivity rather than making every game character a full-power Hermes instance.[6]

**Step 4: Transport selection gate.**

Choose exactly one after a local proof-of-concept:
- **Preferred first:** Mission Control submits an approved request to a narrowly scoped local adapter that runs/contacts the dedicated overseer profile and returns a schema-validated response.
- **Alternative:** a tiny local, read-mostly MCP wrapper with one tool per capability, strict input validation, and no raw shell. MCP is only appropriate after its tools are tested/registered deliberately; it is not a shortcut around authorization.

No direct web-accessible Hermes API endpoint is added. No raw bot string is passed into Hermes as authority.

**Step 5: Verify the response boundary.**

Test that Hermes response data:
- is schema-valid;
- contains only work-order/skill/research proposals;
- cannot name unsupported capability/actions;
- cannot alter approval tier;
- cannot inject raw commands, configuration, or tool calls into bot queues;
- becomes a Mission Control review item or authority-gateway proposal only.

**Step 6: Commit.**

```bash
node --test tests/overseer-contract.test.mjs
node --check webui/server.mjs
git add hermes-overseer minecraft/intelligence webui tests docs
git commit -m "feat: define HermesBot overseer capability boundary"
```

---

### Task 6: Add a genuine collaborative workboard and assistant escalation

**Objective:** Let minions ask for powers from one another and HermesBot while preserving named ownership and visible evidence.

**Files:**
- Create: `minecraft/intelligence/workboard.mjs`
- Create: `tests/workboard.test.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/index.html`
- Modify: `webui/public/app.js`
- Modify: `webui/public/styles.css`

**Step 1: Add work order lifecycle.**

```text
proposed → awaiting_approval | ready → claimed → executing
→ verifying → complete | blocked | expired | failed | cancelled
```

Each work order includes owner, supporting bots, role/capability constraints, resource inputs, allowed zone, expected evidence, attempt limit, deadline, linked goal version, idempotency key, and escalation policy.

**Step 2: Add minion help requests.**

A minion may emit only typed requests such as:
- `need_material`;
- `need_route_scout`;
- `need_food`;
- `need_human_approval`;
- `need_overseer_plan`;
- `need_incident_review`.

The controller resolves a compatible teammate first, then proposes a HermesBot escalation if no safe local resolution exists. The actual in-game message remains concise and human-like: “Need 12 stone for the east path; Flint, can you claim quarry-A?”

**Step 3: Add the Mission Control powers panel.**

Show each character’s:
- role/power card list;
- current lease/work order;
- allowed/blocked action reason;
- latest verified receipt;
- personal/team memory hints;
- help requests and who answered;
- overseer research/planning jobs with status, sources, and approval state.

On mobile this becomes a stacked detail drawer; desktop can show it in the existing dense workspace.

**Step 4: Add player controls.**

Only expose explicit, safe actions:
- approve/reject Tier 3 work order;
- approve/reject skill proposal;
- grant/expire a temporary water-enabled mission;
- pause/resume one bot;
- return one bot to a validated dry yard;
- revoke a work order/lease;
- ask HermesBot to plan, review, or research.

Do not expose “give all powers,” raw prompt editing, arbitrary command execution, direct Hermes tool calls, or fleet-wide unrestricted autonomy.

**Step 5: Test and commit.**

```bash
node --test tests/workboard.test.mjs tests/authority-gateway.test.mjs
node --check minecraft/intelligence/workboard.mjs
node --check minecraft/minion-controller/minion-controller.mjs
node --check webui/server.mjs
git add minecraft/intelligence minecraft/minion-controller webui tests
git commit -m "feat: add HermesCraft powers workboard and escalations"
```

---

### Task 7: Add capability-specific models, budgets, and quality review

**Objective:** Use strong local models where they help, fast models where they suffice, and deterministic code where an LLM adds risk rather than value.

**Files:**
- Create: `minecraft/intelligence/model-policy.mjs`
- Create: `config/model-profiles.example.json`
- Create: `tests/model-policy.test.mjs`
- Modify: `lmstudio-bridge/bridge.mjs`
- Modify: `minecraft/minion-controller/minion-controller.mjs`
- Modify: `webui/server.mjs`
- Modify: `webui/public/app.js`
- Modify: `docs/LM-STUDIO.md`

**Step 1: Define capability-aware routes.**

- Fast local model: status summaries, classified help request draft, routine role action proposal.
- Better reasoning model: workboard planning, build-card proposal, incident review, skill proposal review.
- Deterministic only: survival, safety, authorization, protected-zone checks, action adapter execution, receipts, and verifier logic.
- Dedicated Hermes overseer: research synthesis and high-level reviewed planning, subject to tool/time/token budgets.

**Step 2: Add per-request budgets.**

Set maximum context bytes, output tokens, model wall-clock timeout, per-bot concurrent request count, per-overseer-request tool count, request frequency, and cooldown. Keep user-approved parallel minion inference, but never overlap actions on one bot.

**Step 3: Add evaluator checks.**

Before a proposal transitions from `proposed` to `ready`, validate deterministically. Optionally run a second model only for low-risk consistency checks; agreement does not override safety policy or human approval. Do not pay for a model evaluator where a parser, receipt, or direct state observation is sufficient.

**Step 4: Model test matrix.**

Test each exposed LM Studio model in a non-live/shadow workflow against fixtures for:
- schema compliance;
- valid capability selection;
- safe decline under insufficient evidence;
- no raw command leakage;
- correct recovery behavior after an empty/reasoning-only response;
- latency/timeouts;
- no duplicated actions under concurrent requests.

**Step 5: Commit.**

```bash
node --test tests/model-policy.test.mjs tests/model-protocol.test.mjs
node --check minecraft/intelligence/model-policy.mjs
git add minecraft/intelligence config lmstudio-bridge minecraft/minion-controller webui tests docs
git commit -m "feat: route HermesCraft intelligence by capability and budget"
```

---

### Task 8: Shadow, canary, and fleet rollout with rollback

**Objective:** Prove that upgraded powers improve outcomes before allowing more autonomy.

**Files:**
- Create: `scripts/verify-intelligence-rollout.sh`
- Create: `docs/INTELLIGENCE-ROLLOUT.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `README.md`

**Step 1: Offline test gate.**

Run all unit/contract tests, syntax checks, secret scan, and `git diff --check` before any local service restart.

**Step 2: Observe mode.**

Run intelligence generation without execution for 30–60 minutes. Compare proposals to current decisions: valid schema rate, rejected unsafe proposals, duplicate prevention, model latency, no sensitive field retention, and no action calls.

**Step 3: One-minion canary.**

Choose one noncritical role and enable only `safe-regroup`, `team-help-request`, and one low-risk role card. Verify health/status, bot connection, receipts, team chat, no new death, no protected-zone rejection due to a bypass, and correct rollback to old behavior.

**Step 4: Add HermesBot planning in proposal-only mode.**

For one player-approved village goal, have HermesBot produce a workboard proposal. Review source links, assumptions, work order scope, and safety tiers in Mission Control. Do not dispatch until approved.

**Step 5: Gradual capability expansion.**

Enable one card per role only after at least three successful, verified canary runs. Leave any failed card disabled and keep its evidence for review.

**Step 6: Fleet acceptance criteria.**

- all six bot APIs remain healthy;
- no player structure modification;
- no action executes without a valid receipt;
- no same-bot concurrent actions;
- no unbounded logs or memory growth;
- death rate does not rise from the baseline;
- water/death recovery remains higher priority than model plans;
- all approval-gated actions visibly require player confirmation;
- disabling `INTELLIGENCE_MODE` returns safely to legacy controller behavior without restarting Minecraft or LM Studio.

**Step 7: Commit/release.**

```bash
bash scripts/verify-intelligence-rollout.sh
bash scripts/secret-scan.sh
git diff --check
git add scripts docs README.md
git commit -m "docs: add HermesCraft intelligence rollout and rollback guide"
```

---

## Recommended implementation order

1. **P0:** Tasks 1–3 — contracts, typed proposals, deterministic authority gateway.
2. **P0:** Existing dry-ground/death/protected-structure safety work remains a prerequisite for any autonomous power rollout.
3. **P1:** Task 4 — reviewed memory and skillbooks.
4. **P1:** Task 6 — workboard, minion-to-minion help, player approval UX.
5. **P2:** Task 5 — constrained HermesBot overseer integration after local contracts and review UX exist.
6. **P2:** Task 7 — capability-specific model routes/evaluation.
7. **P3:** Task 8 — shadow → one-minion canary → approved fleet expansion.

## Risks and mitigations

- **Local models may emit plausible but incorrect plans.** JSON schema constrains shape, not truth. Verify all facts/actions with code and live bot state.[1]
- **“Hermes powers” could accidentally become system powers.** Keep Hermes integration outside the game action path; only structured proposals cross the boundary.
- **Learning can preserve bad behavior.** No auto-promotion. Every durable procedure comes from verified receipts, repeated success, and player approval.
- **Several bots can make duplicate/conflicting choices.** Controller-owned leases, idempotency keys, area/depot reservations, and one action slot per bot are mandatory.
- **More agents may overload LM Studio.** Use budgets and capability routing; retain user-approved parallel inference but avoid concurrent prompts for the same bot.
- **Tool integrations increase attack surface.** Any future MCP capability is a narrow allowlisted wrapper with one validated operation per tool—not a general shell bridge.
- **The system could grow too large.** Start in-process with Node modules and JSONL; defer Postgres, queues, distributed agent frameworks, and a full 3D control plane until measured needs justify them. State-machine/breaker/trace patterns are inspiration, not a dependency import.[3]

## Completion checklist

- [ ] All intelligence-generated actions pass contracts and the authority gateway.
- [ ] HermesBot can plan/research/propose skills but cannot directly control the system or bypass Minecraft policy.
- [ ] Every minion has role powers, personal skillbook access, shared memory retrieval, and team help escalation.
- [ ] Every power has an explicit tier, budget, verifier, receipts, rollback, and tests.
- [ ] Player structure protection, dry-ground safety, and player confirmation prevail over all models and skills.
- [ ] Mission Control visibly explains who can do what, why a proposal was accepted/blocked, and how to revoke it.
- [ ] No credentials, private paths, world saves, prompts, or raw player chat are committed or exposed.

Use the existing stable `node:test` runner for the contract, gateway, skillbook, and rollout test suites rather than introducing a separate test framework.[4]

## Sources

[1] https://lmstudio.ai/docs/developer/openai-compat/structured-output
[2] https://lmstudio.ai/docs/developer/openai-compat/tools
[3] https://github.com/kreftamarcio/multi-agent-orchestrator
[4] https://nodejs.org/api/test.html
[5] https://hermes-agent.nousresearch.com/docs/llms.txt
[6] https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
