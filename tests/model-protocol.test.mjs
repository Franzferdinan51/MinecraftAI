import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProposalEnvelope } from '../minecraft/intelligence/model-protocol.mjs';

const proposal = {
  id: 'proposal-123', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
  args: { block: 'stone', count: 12, area: 'quarry-a' }, reason: 'Need stone.',
  expectedEvidence: ['inventory_delta'], riskTier: 1, idempotencyKey: 'goal-7:flint:stone-12',
};

test('parses a bounded JSON proposal envelope', () => {
  const result = parseProposalEnvelope(JSON.stringify({
    schemaVersion: 1,
    summary: 'Flint can safely gather stone.',
    proposals: [proposal],
    helpRequests: [],
    memoryCandidates: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.proposals.length, 1);
  assert.equal(result.value.proposals[0].bot, 'Flint');
});

test('rejects malformed JSON and does not create a partial action', () => {
  assert.deepEqual(parseProposalEnvelope('{not json}'), { ok: false, error: 'invalid_json' });
  assert.deepEqual(parseProposalEnvelope(''), { ok: false, error: 'empty_output' });
});

test('rejects a raw mc command even when the surrounding JSON is valid', () => {
  const result = parseProposalEnvelope(JSON.stringify({
    schemaVersion: 1, summary: 'unsafe', proposals: [{ ...proposal, command: 'mc dig 1 2 3' }], helpRequests: [], memoryCandidates: [],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_proposal');
});

test('rejects unsupported schema versions and oversized batches', () => {
  assert.equal(parseProposalEnvelope(JSON.stringify({ schemaVersion: 2, summary: 'x', proposals: [], helpRequests: [], memoryCandidates: [] })).error, 'unsupported_schema');
  assert.equal(parseProposalEnvelope(JSON.stringify({ schemaVersion: 1, summary: 'x', proposals: Array.from({ length: 7 }, () => proposal), helpRequests: [], memoryCandidates: [] })).error, 'too_many_proposals');
});
