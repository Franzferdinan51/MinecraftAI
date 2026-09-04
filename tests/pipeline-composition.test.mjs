import test from 'node:test';
import assert from 'node:assert/strict';

import { authorize } from '../minecraft/intelligence/authority-gateway.mjs';
import { deriveSafetyState } from '../minecraft/intelligence/safety-state.mjs';
import { createQueue } from '../minecraft/intelligence/approvals-queue.mjs';

// Cross-module proof: independently built stages share compatible shapes.
// Vitals → safety-state → gateway botState; queue → policy approvals.

const FARM_PROPOSAL = Object.freeze({
  id: 'p-001',
  bot: 'Moss',
  capability: 'skill.run',
  skill: 'farm-food-loop',
  args: { count: 4, field: 'north-field' },
  reason: 'Restock depot food stores',
  expectedEvidence: ['inventory_delta', 'task_complete'],
  riskTier: 1,
  idempotencyKey: 'pipe-001',
});

const TIER3_PROPOSAL = Object.freeze({
  id: 'p-003',
  bot: 'Steve',
  capability: 'build_footprint.propose',
  args: { area: 'north-pad' },
  reason: 'Propose depot pad footprint',
  expectedEvidence: ['blueprint_diff'],
  riskTier: 3,
  idempotencyKey: 'pipe-003',
  requiresApproval: true,
});

function farmCtx(botState) {
  return {
    mode: 'active',
    botState,
    leases: { field: { field: 'north-field', expires: Date.now() + 60_000 } },
    usedKeys: new Map(),
  };
}

test('healthy vitals flow through safety-state into a gateway allow', () => {
  const state = deriveSafetyState({ health: 20, food: 20, deaths: 2, recentDeaths: 0 });
  const result = authorize(FARM_PROPOSAL, farmCtx({ Moss: state }));
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'authorized');
  assert.equal(result.adapter.kind, 'skill_card');
  assert.equal(result.adapter.skill, 'farm-food-loop');
  assert.equal(result.receipt.idempotencyKey, 'pipe-001');
});

test('low-health vitals flow through safety-state into a recovery deny', () => {
  const state = deriveSafetyState({ health: 7.3, food: 16, deaths: 10, recentDeaths: 0 });
  assert.equal(state.recoveryAction, 'eat');
  const result = authorize(FARM_PROPOSAL, farmCtx({ Moss: state }));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'bot_in_recovery');
});

test('unknown vitals fail closed into a hold deny', () => {
  const state = deriveSafetyState({});
  const result = authorize(FARM_PROPOSAL, farmCtx({ Moss: state }));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'bot_hold');
});

test('queue-approved tier 3 stays proposal-only through the gateway', () => {
  const queue = createQueue({ now: () => 2_000_000 });
  const rec = queue.request({
    idempotencyKey: 'pipe-003',
    bot: 'Steve',
    capability: 'build_footprint.propose',
    summary: 'Depot pad footprint proposal',
    riskTier: 3,
    requestedBy: 'HermesBot',
  });
  queue.approve(rec.id, { by: 'player' });
  const healthy = deriveSafetyState({ health: 20, food: 20 });
  const result = authorize(TIER3_PROPOSAL, {
    mode: 'canary',
    canaryBot: 'Steve',
    botState: { Steve: healthy },
    approvals: [queue.matchFor({ idempotencyKey: 'pipe-003' })],
    usedKeys: new Map(),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'tier_3_proposal');
  assert.equal(result.adapter, undefined);
});

test('unapproved tier 3 is denied for lack of player approval', () => {
  const healthy = deriveSafetyState({ health: 20, food: 20 });
  const result = authorize(TIER3_PROPOSAL, {
    mode: 'canary',
    canaryBot: 'Steve',
    botState: { Steve: healthy },
    approvals: [],
    usedKeys: new Map(),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'approval_required');
});
