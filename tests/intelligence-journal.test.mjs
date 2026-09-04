import assert from 'node:assert/strict';
import test from 'node:test';

import { createIntelligenceJournal } from '../minecraft/intelligence/journal.mjs';

const content = JSON.stringify({
  schemaVersion: 1,
  summary: 'Flint can safely gather stone.',
  proposals: [{
    id: 'proposal-123', bot: 'Flint', capability: 'skill.run', skill: 'safe-quarry-batch',
    args: { block: 'stone', count: 12, area: 'quarry-a' }, reason: 'Need stone.',
    expectedEvidence: ['inventory_delta'], riskTier: 1, idempotencyKey: 'goal-7:flint:stone-12',
  }],
  helpRequests: [], memoryCandidates: [],
});

test('journal records sanitized observe-only decisions without raw model output', () => {
  const journal = createIntelligenceJournal({ now: () => 12345 });
  const record = journal.recordModelOutput({ source: 'Flint', content, mode: 'observe' });
  assert.equal(record.status, 'accepted');
  assert.equal(record.decisions[0].reason, 'observe_mode');
  assert.equal(record.decisions[0].dispatch, false);
  assert.equal('content' in record, false);
  assert.deepEqual(journal.list(), [record]);
});

test('journal records a parse failure with no partial proposal', () => {
  const journal = createIntelligenceJournal({ now: () => 12345 });
  const record = journal.recordModelOutput({ source: 'Flint', content: '{bad json}', mode: 'observe' });
  assert.deepEqual(record, { at: 12345, source: 'Flint', status: 'rejected', error: 'invalid_json', decisions: [] });
});

test('journal bounds retained records', () => {
  const journal = createIntelligenceJournal({ limit: 2, now: (() => { let n = 0; return () => ++n; })() });
  journal.recordModelOutput({ source: 'Flint', content, mode: 'observe' });
  journal.recordModelOutput({ source: 'Flint', content, mode: 'observe' });
  journal.recordModelOutput({ source: 'Flint', content, mode: 'observe' });
  assert.equal(journal.list().length, 2);
  assert.equal(journal.list()[0].at, 2);
});
