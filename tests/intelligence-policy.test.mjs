import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProposal } from '../minecraft/intelligence/policy.mjs';

const quarryProposal = {
  id: 'proposal-123', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
  args: { block: 'stone', count: 12, area: 'quarry-a' }, reason: 'Need stone.',
  expectedEvidence: ['inventory_delta'], riskTier: 1, idempotencyKey: 'goal-7:flint:stone-12',
};

test('observe mode records a valid proposal without allowing dispatch', () => {
  const decision = evaluateProposal(quarryProposal, { mode: 'observe' });
  assert.equal(decision.accepted, true);
  assert.equal(decision.dispatch, false);
  assert.equal(decision.reason, 'observe_mode');
});

test('active mode permits an allowlisted role skill outside protected space', () => {
  const decision = evaluateProposal(quarryProposal, { mode: 'active' });
  assert.equal(decision.accepted, true);
  assert.equal(decision.dispatch, true);
  assert.equal(decision.reason, 'authorized');
});

test('policy rejects a proposal that targets the protected house radius', () => {
  const decision = evaluateProposal({
    ...quarryProposal,
    args: { ...quarryProposal.args, x: 50, y: 63, z: 85 },
  }, { mode: 'active', house: { x: 50, y: 63, z: 85, radius: 8 } });
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, 'protected_zone');
});

test('policy rejects active water-enabled work without explicit approval', () => {
  const decision = evaluateProposal({
    ...quarryProposal,
    args: { ...quarryProposal.args, waterEnabled: true },
  }, { mode: 'active' });
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, 'approval_required');
});

test('Tier 3 proposal waits for a matching human approval record', () => {
  const proposal = {
    id: 'proposal-build-site', bot: 'Steve', capability: 'build_footprint.propose',
    args: { area: 'new-village-footprint', width: 8, depth: 8 },
    reason: 'Player requested a new house footprint.', expectedEvidence: ['approval_record'],
    riskTier: 3, idempotencyKey: 'goal-8:site-a', requiresApproval: true,
  };
  assert.equal(evaluateProposal(proposal, { mode: 'active' }).reason, 'approval_required');
  assert.equal(evaluateProposal(proposal, { mode: 'active', approvals: [{ idempotencyKey: 'goal-8:site-a', approved: true }] }).dispatch, false);
  assert.equal(evaluateProposal(proposal, { mode: 'active', approvals: [{ idempotencyKey: 'goal-8:site-a', approved: true }] }).reason, 'tier_3_proposal');
});
