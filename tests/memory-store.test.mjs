import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryStore } from '../minecraft/intelligence/memory-store.mjs';

const T0 = 1_700_000_000_000;

function candidate(over = {}) {
  return {
    id: 'mem-1', bot: 'Flint', kind: 'supply_change',
    summary: 'Delivered 12 stone to depot',
    source: 'verified_receipt', receipts: ['k-quarry-1'],
    ...over,
  };
}

test('rejects episodic candidates from untrusted sources', () => {
  const store = createMemoryStore({ now: () => T0 });
  const r = store.record(candidate({ id: 'm-bad', source: 'model_chat' }));
  assert.equal(r.ok, false);
});

test('rejects entries carrying raw prompts or chain-of-thought', () => {
  const store = createMemoryStore({ now: () => T0 });
  const r = store.record(candidate({ id: 'm-leak', prompt: 'system...', chainOfThought: 'hmm' }));
  assert.equal(r.ok, false);
});

test('accepts verified candidates into bounded, expiring episodic memory', () => {
  const store = createMemoryStore({ now: () => T0, episodicMax: 2, episodicTtlMs: 1000 });
  assert.equal(store.record(candidate({ id: 'm-1' })).ok, true);
  assert.equal(store.record(candidate({ id: 'm-2' })).ok, true);
  assert.equal(store.record(candidate({ id: 'm-3' })).ok, true);
  assert.equal(store.list('episodic').length, 2);
  const entry = store.list('episodic').find((e) => e.id === 'm-3');
  assert.equal(entry.expiresAt, T0 + 1000);
});

test('pruneExpired drops only stale entries', () => {
  let now = T0;
  const store = createMemoryStore({ now: () => now, episodicTtlMs: 1000 });
  store.record(candidate({ id: 'm-1' }));
  now += 2000;
  store.record(candidate({ id: 'm-2' }));
  assert.equal(store.pruneExpired(), 1);
  assert.deepEqual(store.list('episodic').map((e) => e.id), ['m-2']);
});

test('semantic promotion needs corroboration or player confirmation', () => {
  const store = createMemoryStore({ now: () => T0 });
  store.record(candidate({ id: 'm-1' }));
  assert.equal(store.promoteToSemantic('m-1', {}).ok, false);
  assert.equal(store.promoteToSemantic('m-1', { playerConfirmed: true }).ok, true);
  assert.equal(store.list('semantic').length, 1);
});

test('retrieval quota caps verified memories at five', () => {
  const store = createMemoryStore({ now: () => T0, episodicMax: 20 });
  for (let i = 0; i < 8; i++) store.record(candidate({ id: `m-${i}` }));
  const ctx = store.contextFor('Flint');
  assert.ok(ctx.memories.length <= 5);
});
