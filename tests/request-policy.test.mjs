import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestPolicy, isTerminatedError } from '../lmstudio-bridge/request-policy.mjs';

test('healthy requests never skip the model call', () => {
  const policy = createRequestPolicy({ now: () => 1000 });
  assert.equal(policy.shouldSkip(), false);
  policy.recordSuccess();
  assert.equal(policy.shouldSkip(), false);
});

test('three consecutive failures open a cooldown that skips model calls', () => {
  let now = 1000;
  const policy = createRequestPolicy({ maxConsecutive: 3, cooldownMs: 60_000, now: () => now });
  policy.recordFailure();
  policy.recordFailure();
  assert.equal(policy.shouldSkip(), false);
  policy.recordFailure();
  assert.equal(policy.shouldSkip(), true);
  now += 59_000;
  assert.equal(policy.shouldSkip(), true);
  now += 2000;
  assert.equal(policy.shouldSkip(), false);
});

test('a success closes the cooldown early', () => {
  let now = 1000;
  const policy = createRequestPolicy({ maxConsecutive: 2, cooldownMs: 60_000, now: () => now });
  policy.recordFailure();
  policy.recordFailure();
  assert.equal(policy.shouldSkip(), true);
  policy.recordSuccess();
  assert.equal(policy.shouldSkip(), false);
});

test('state exposes consecutive count and cooling flag', () => {
  const policy = createRequestPolicy({ now: () => 1000 });
  policy.recordFailure();
  assert.deepEqual(policy.state(), { consecutive: 1, cooling: false });
});

test('terminated generations classify as individual cancellations', () => {
  assert.equal(isTerminatedError(400, '{"error":"terminated"}'), true);
  assert.equal(isTerminatedError(400, 'ok'), false);
  assert.equal(isTerminatedError(500, '{"error":"terminated"}'), false);
  assert.equal(isTerminatedError(null, ''), false);
});
