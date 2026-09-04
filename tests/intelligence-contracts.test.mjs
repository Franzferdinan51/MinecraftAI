import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTORS,
  ContractError,
  normalizeProposal,
  validateProposal,
} from '../minecraft/intelligence/contracts.mjs';
import { CAPABILITIES, capabilityFor } from '../minecraft/intelligence/capabilities.mjs';
import { SKILL_CARDS, skillCardFor } from '../minecraft/intelligence/skill-cards.mjs';

test('defines each HermesCraft actor with one bounded role', () => {
  assert.deepEqual(Object.keys(ACTORS).sort(), ['DuckBot', 'Ember', 'Flint', 'Moss', 'Reed', 'Steve']);
  for (const actor of Object.values(ACTORS)) assert.equal(actor.agentKind, 'hermescraft-agent');
  assert.equal(ACTORS.DuckBot.role, 'overseer');
  assert.equal(ACTORS.Reed.role, 'builder');
  assert.equal(ACTORS.Ember.role, 'scout');
});

test('capability registry forbids raw system and server authority', () => {
  assert.ok(CAPABILITIES['team.request_help']);
  assert.ok(CAPABILITIES['build_card.execute']);
  for (const forbidden of ['shell.execute', 'filesystem.read', 'filesystem.write', 'rcon.command', 'server.admin', 'mcp.invoke']) {
    assert.equal(capabilityFor(forbidden), null, `${forbidden} must never be a Minecraft capability`);
  }
});

test('role lookup returns only approved skill cards', () => {
  assert.equal(skillCardFor('safe-regroup').roles.includes('all'), true);
  assert.equal(skillCardFor('small-approved-build').roles.includes('builder'), true);
  assert.equal(skillCardFor('small-approved-build').roles.includes('miner'), false);
  assert.equal(SKILL_CARDS['safe-quarry-batch'].maxActions, 4);
});

test('normalizes one bounded Tier 1 skill proposal', () => {
  const result = normalizeProposal({
    id: 'proposal-123',
    bot: 'Flint',
    capability: 'skill.run',
    skill: 'safe-quarry-batch',
    args: { block: 'stone', count: 12, area: 'quarry-a' },
    reason: 'Reed needs stone for an approved path.',
    expectedEvidence: ['inventory_delta', 'task_complete'],
    riskTier: 1,
    idempotencyKey: 'goal-7:flint:stone-12',
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.bot, 'Flint');
  assert.equal(result.value.skill, 'safe-quarry-batch');
  assert.equal(result.value.requiresApproval, false);
});

test('rejects unknown actors, extra fields, invalid ranges, and raw mc commands', () => {
  const valid = {
    id: 'proposal-123', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
    args: { block: 'stone', count: 12, area: 'quarry-a' }, reason: 'Need stone.',
    expectedEvidence: ['inventory_delta'], riskTier: 1, idempotencyKey: 'goal-7:flint:stone-12',
  };
  assert.throws(() => validateProposal({ ...valid, bot: 'UnknownBot' }), ContractError);
  assert.throws(() => validateProposal({ ...valid, command: 'mc dig 1 2 3' }), ContractError);
  assert.throws(() => validateProposal({ ...valid, args: { ...valid.args, count: 999 } }), ContractError);
  assert.throws(() => validateProposal({ ...valid, expectedEvidence: [] }), ContractError);
});

test('requires human approval metadata for Tier 3 proposals', () => {
  const proposal = {
    id: 'proposal-build-site', bot: 'Steve', capability: 'build_footprint.propose',
    args: { area: 'new-village-footprint', width: 8, depth: 8 },
    reason: 'Player requested a new house footprint.', expectedEvidence: ['approval_record'],
    riskTier: 3, idempotencyKey: 'goal-8:site-a', requiresApproval: true,
  };
  assert.equal(validateProposal(proposal).requiresApproval, true);
  assert.throws(() => validateProposal({ ...proposal, requiresApproval: false }), ContractError);
});
