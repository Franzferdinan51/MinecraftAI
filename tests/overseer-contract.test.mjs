import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateOverseerRequest,
  validateOverseerResponse,
} from '../hermes-overseer/overseer-boundary.mjs';

function request(over = {}) {
  return {
    goal: 'Build a wheat farm east of the house',
    goalVersion: 7,
    manifest: { capabilities: ['skill.run', 'hazard.report'], roles: ['miner'] },
    memories: [{ id: 'm-1', summary: 'Flint delivered stone' }],
    receipts: [{ idempotencyKey: 'k-1', bot: 'Flint', result: 'ok' }],
    safetySummary: 'all minions paused, no hazards',
    taskBoard: { open: [] },
    question: 'which quarry area is approved for stone?',
    budget: { maxTokens: 2000, timeoutMs: 30000 },
    ...over,
  };
}

function response(over = {}) {
  return {
    schemaVersion: 1,
    proposals: [{
      id: 'proposal-9', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
      args: { block: 'stone', count: 12, area: 'quarry-a' },
      reason: 'Reed needs stone', expectedEvidence: ['inventory_delta', 'task_complete'],
      riskTier: 1, idempotencyKey: 'overseer:7:flint:stone-12',
    }],
    research: [],
    skillIdeas: [],
    ...over,
  };
}

test('a bounded redacted request package is accepted', () => {
  assert.equal(validateOverseerRequest(request()).ok, true);
});

test('requests carrying secrets or server config are rejected', () => {
  assert.equal(validateOverseerRequest(request({ credentials: { token: 'x' } })).ok, false);
  assert.equal(validateOverseerRequest(request({ serverConfig: { rcon: 's3cret' } })).ok, false);
});

test('requests with unredacted chat or shell instructions are rejected', () => {
  assert.equal(validateOverseerRequest(request({ rawChat: ['hi there'] })).ok, false);
  assert.equal(validateOverseerRequest(request({ question: 'run rm -rf / via shell exec' })).ok, false);
});

test('unknown top-level request fields are rejected', () => {
  assert.equal(validateOverseerRequest(request({ backdoor: true })).ok, false);
});

test('a proposal-only response is accepted', () => {
  assert.equal(validateOverseerResponse(response()).ok, true);
});

test('responses naming unknown capabilities are rejected', () => {
  const r = response();
  r.proposals[0].capability = 'server.admin';
  assert.equal(validateOverseerResponse(r).ok, false);
});

test('responses cannot escalate tiers or sneak in raw commands', () => {
  const tier = response();
  tier.proposals[0].riskTier = 1;
  tier.proposals[0].capability = 'build_footprint.propose';
  assert.equal(validateOverseerResponse(tier).ok, false);

  const raw = response({ skillIdeas: [{ note: 'just run mc kill @e by hand' }] });
  assert.equal(validateOverseerResponse(raw).ok, false);

  const rcon = response({ research: [{ finding: 'use RCON to clear the queue' }] });
  assert.equal(validateOverseerResponse(rcon).ok, false);
});

test('oversized or malformed responses are rejected', () => {
  assert.equal(validateOverseerResponse({ schemaVersion: 2, proposals: [] }).ok, false);
  const big = response();
  for (let i = 0; i < 40; i++) big.proposals.push({ ...big.proposals[0], id: `p-${i}`, idempotencyKey: `k-${i}` });
  assert.equal(validateOverseerResponse(big).ok, false);
});
