import assert from 'node:assert/strict';
import test from 'node:test';

import { authorize, verifyReceipt } from '../minecraft/intelligence/authority-gateway.mjs';

const quarry = {
  id: 'proposal-1', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
  args: { block: 'stone', count: 12, area: 'quarry-a' },
  reason: 'Reed needs stone', expectedEvidence: ['inventory_delta', 'task_complete'],
  riskTier: 1, idempotencyKey: 'k-quarry-1',
};

function ctx(over = {}) {
  return {
    mode: 'active', house: { x: 50, y: 63, z: 85, radius: 8 },
    approvals: [], leases: {}, usedKeys: new Map(), botState: {},
    ...over,
  };
}

test('rejected role/capability produces no adapter or HTTP descriptor', () => {
  const bad = { ...quarry, id: 'p-bad', bot: 'Moss', idempotencyKey: 'k-bad' };
  const d = authorize(bad, ctx());
  assert.equal(d.allowed, false);
  assert.equal(d.adapter, undefined);
  assert.equal(d.http, undefined);
});

test('Tier 3 without human approval is rejected', () => {
  const t3 = {
    id: 'p-t3', bot: 'Steve', capability: 'build_footprint.propose',
    args: { x: 100, z: 100 }, reason: 'new hut', expectedEvidence: ['arrival'],
    riskTier: 3, idempotencyKey: 'k-t3', requiresApproval: true,
  };
  const d = authorize(t3, ctx());
  assert.equal(d.allowed, false);
  assert.match(d.reason, /approval/);
});

test('bot in safety recovery rejects movement and building', () => {
  const d = authorize(quarry, ctx({ botState: { Flint: { inRecovery: true } } }));
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'bot_in_recovery');
});

test('busy bot rejects a new action', () => {
  const d = authorize(quarry, ctx({ botState: { Flint: { busy: true } } }));
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'bot_busy');
});

test('held bot rejects a new action without entering recovery', () => {
  const d = authorize(quarry, ctx({ botState: { Flint: { hold: true } } }));
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'bot_hold');
});

test('duplicate idempotency key returns the original receipt, no new action', () => {
  const usedKeys = new Map();
  const first = authorize(quarry, ctx({ usedKeys }));
  assert.equal(first.allowed, true);
  const second = authorize({ ...quarry, id: 'proposal-2' }, ctx({ usedKeys }));
  assert.equal(second.allowed, false);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.receipt, first.receipt);
});

test('ranges outside card limits are rejected', () => {
  const far = { ...quarry, id: 'p-far', args: { ...quarry.args, x: 9000, z: 9000 }, idempotencyKey: 'k-far' };
  const d = authorize(far, ctx());
  assert.equal(d.allowed, false);
  assert.match(d.reason, /budget|limit/);
});

test('protected-zone dig and collect are blocked', () => {
  const dig = {
    id: 'p-dig', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
    args: { block: 'stone', count: 4, x: 50, z: 85 },
    reason: 'test', expectedEvidence: ['inventory_delta'],
    riskTier: 1, idempotencyKey: 'k-dig',
  };
  const d = authorize(dig, ctx());
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'protected_zone');
});

test('expired lease blocks dispatch', () => {
  const depot = {
    id: 'p-depot', bot: 'Moss', capability: 'skill.run', skill: 'depot-delivery',
    args: { depot: 'main', count: 4 },
    reason: 'store wheat', expectedEvidence: ['inventory_delta', 'task_complete'],
    riskTier: 1, idempotencyKey: 'k-depot',
  };
  const d = authorize(depot, ctx({ leases: { depot: { depot: 'main', expires: Date.now() - 1000 } } }));
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'lease_expired');
});

test('authorized Tier 1 skill yields an allowlisted adapter descriptor', () => {
  const d = authorize(quarry, ctx());
  assert.equal(d.allowed, true);
  assert.ok(d.adapter);
  assert.equal(d.http, undefined);
  assert.ok(d.receipt && d.receipt.idempotencyKey === 'k-quarry-1');
});

test('evidence mismatch verifies as needs_review, never fabricated completion', () => {
  const v = verifyReceipt(
    { expectedEvidence: ['inventory_delta', 'task_complete'] },
    { evidence: ['arrival'] },
  );
  assert.equal(v.verdict, 'needs_review');
});
