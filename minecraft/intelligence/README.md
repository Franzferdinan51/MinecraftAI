# Intelligence layer (`minecraft/intelligence/`)

Typed proposals and deterministic safety checks sit between model output
and any Minecraft action. Models propose; code authorizes. Nothing here
touches the network, the filesystem, or a bot queue.

## Files

| File | Job |
|---|---|
| `capabilities.mjs` | Allowlist: every named power, its tier, permitted roles. No shell, RCON, credential, or arbitrary-command capability exists. |
| `skill-cards.mjs` | 8 versioned role skill cards (`safe-regroup`, `hazard-survey`, `safe-quarry-batch`, `farm-food-loop`, `depot-delivery`, `material-preflight`, `small-approved-build`, `team-help-request`). |
| `contracts.mjs` | `ACTORS` (all six bots share the `hermescraft-agent` identity with one bounded role each) plus strict proposal validation. Tier 3 requires `requiresApproval: true`. |
| `model-protocol.mjs` | Parses bounded JSON proposal envelopes (schema v1, max 6 proposals). Malformed input yields no partial action; raw `mc` strings are rejected. |
| `policy.mjs` | `evaluateProposal()`: observe/shadow/canary/active modes, protected house radius, water-enabled approval rule. Tier 3 never dispatches, even when approved. |
| `journal.mjs` | Bounded in-memory audit log of sanitized decisions. Stores receipts and summaries only — never prompts, chain-of-thought, or chat. `recordShadow()` retains observe-only shadow verdicts alongside proposal records. |
| `authority-gateway.mjs` | `authorize()`: schema → role/capability → bot safety state → policy → lease → budget → idempotency → adapter. `verifyReceipt()` returns `verified` or `needs_review`, never a fabricated completion. |
| `action-adapters.mjs` | Builds bounded skill-card action *descriptors* (plain data). No HTTP/RCON/shell/queue calls. Raw dig/place/admin have no adapter. |
| `memory-store.mjs` | Three-scope team memory: expiring episodic, corroborated semantic, review-gated procedural. Only verified receipts and trusted observations are stored. |
| `learning-policy.mjs` | Procedural promotion needs 3 clean verified uses, a reproducible card, a review record, and explicit player approval. No self-promotion. |
| `role-skillbook.mjs` | Per-bot active cards from the role registry; learned cards stay under `pendingReview` until approved. |
| `safety-state.mjs` | `deriveSafetyState()`: deterministic hold/recovery derivation from vitals (health, food, death streak, water, hostiles, stuck, connection, pause). Recovery outranks model plans; missing vitals fail closed. Feeds the gateway's `botState` flags. |
| `approvals-queue.mjs` | `createQueue()`: Tier 3 player-approval lifecycle (pending → approved/rejected/expired, single-use consume). Approved records match the exact shape `policy.mjs` checks. The deterministic producer for policy's approvals arrays. |
| `shadow-audit.mjs` | `auditAction()`: pure shadow verdicts over live `mc` traffic (would_allow / would_hold / would_deny). Only world-altering verbs are checked against the protected radius; movement and chat never trigger it. Called from the controller's action choke point in try/catch — observe-only, never gates. |

## Status

- Controller exposes `GET /intelligence` and `POST /intelligence/proposal` in **observe-only** mode (`INTELLIGENCE_MODE`, default `observe`; optional `INTELLIGENCE_CANARY` bot name). Intake records and audits; it cannot queue actions.
- The authority gateway is implemented and tested but **not wired into any dispatch path yet**. Wiring it is a future canary-gated step.
- Mission Control proxies the ledger at `/api/intelligence` and `/api/intelligence/proposal`.

## Tests

```bash
node --test tests/intelligence-contracts.test.mjs tests/intelligence-policy.test.mjs \
  tests/model-protocol.test.mjs tests/intelligence-journal.test.mjs \
  tests/intelligence-controller-integration.test.mjs tests/authority-gateway.test.mjs \
  tests/memory-store.test.mjs tests/learning-policy.test.mjs \
  tests/safety-state.test.mjs tests/overseer-contract.test.mjs \
  tests/webui-intelligence-routes.test.mjs tests/approvals-queue.test.mjs
```
