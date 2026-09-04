import test from 'node:test';
import assert from 'node:assert/strict';

import { createQueue } from '../minecraft/intelligence/approvals-queue.mjs';

const REQUEST = Object.freeze({
  idempotencyKey: 'req-001',
  bot: 'Reed',
  capability: 'build_footprint.propose',
  skill: 'small-approved-build',
  summary: 'Build 5x5 depot pad outside protected radius',
  riskTier: 3,
  requestedBy: 'HermesBot',
});

function freshQueue() {
  return createQueue({ now: () => 1_000_000 });
}

test('new request enters the pending queue with an expiry', () => {
  const q = freshQueue();
  const rec = q.request(REQUEST);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.approved, false);
  assert.equal(rec.idempotencyKey, 'req-001');
  assert.ok(rec.expiresAt > 1_000_000);
  assert.ok(Object.isFrozen(rec));
});

test('request requires identity, key, and tier fields', () => {
  const q = freshQueue();
  assert.throws(() => q.request({ ...REQUEST, idempotencyKey: '' }), /idempotencyKey/);
  assert.throws(() => q.request({ ...REQUEST, bot: 'Nobody' }), /unknown bot/);
  assert.throws(() => q.request({ ...REQUEST, riskTier: 1 }), /tier 3/i);
});

test('duplicate idempotency keys are rejected while pending', () => {
  const q = freshQueue();
  q.request(REQUEST);
  assert.throws(() => q.request(REQUEST), /duplicate/);
});

test('approve flips the record and feeds policy-shaped matching', () => {
  const q = freshQueue();
  const rec = q.request(REQUEST);
  const approved = q.approve(rec.id, { by: 'player' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved, true);
  const match = q.matchFor({ idempotencyKey: 'req-001' });
  assert.equal(match.approved, true);
  assert.equal(match.idempotencyKey, 'req-001');
});

test('reject records the reason and never matches', () => {
  const q = freshQueue();
  const rec = q.request(REQUEST);
  const rejected = q.reject(rec.id, { by: 'player', reason: 'too close to yard' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.approved, false);
  assert.equal(q.matchFor({ idempotencyKey: 'req-001' }), null);
});

test('decided records are immutable to re-decision', () => {
  const q = freshQueue();
  const rec = q.request(REQUEST);
  q.approve(rec.id, { by: 'player' });
  assert.throws(() => q.reject(rec.id, { by: 'player' }), /already decided/);
});

test('expired pendings sweep to expired and never match', () => {
  let now = 1_000_000;
  const q = createQueue({ now: () => now, ttlMs: 60_000 });
  const rec = q.request(REQUEST);
  now += 61_000;
  const swept = q.sweep();
  assert.deepEqual(swept, [rec.id]);
  assert.equal(q.get(rec.id).status, 'expired');
  assert.equal(q.matchFor({ idempotencyKey: 'req-001' }), null);
});

test('approved records survive sweeps until consumed', () => {
  let now = 1_000_000;
  const q = createQueue({ now: () => now, ttlMs: 60_000 });
  const rec = q.request(REQUEST);
  q.approve(rec.id, { by: 'player' });
  now += 61_000;
  assert.deepEqual(q.sweep(), []);
  assert.equal(q.matchFor({ idempotencyKey: 'req-001' }).approved, true);
});

test('consume removes an approved record after use', () => {
  const q = freshQueue();
  const rec = q.request(REQUEST);
  q.approve(rec.id, { by: 'player' });
  assert.equal(q.consume(rec.id), true);
  assert.equal(q.matchFor({ idempotencyKey: 'req-001' }), null);
});

test('pending list is bounded and read-only', () => {
  const q = freshQueue();
  q.request(REQUEST);
  const pending = q.pending();
  assert.equal(pending.length, 1);
  assert.ok(Object.isFrozen(pending));
});
