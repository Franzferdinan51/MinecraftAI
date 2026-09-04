import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOverseerRequest } from '../hermes-overseer/request-builder.mjs';
import { validateOverseerRequest } from '../hermes-overseer/overseer-boundary.mjs';

const SNAPSHOT = Object.freeze({
  goal: 'Build a safe starter village with the other players as a coordinated team.',
  goalVersion: 1,
  minions: [
    { name: 'Steve', role: 'planner', paused: false, ticks: 60, online: true },
    { name: 'Moss', role: 'farmer', paused: false, ticks: 55, online: true },
  ],
  vitals: {
    Steve: { health: 20, food: 20 },
    Moss: { health: 7.3, food: 16 },
  },
  records: [
    { source: 'Steve', status: 'shadow', summary: 'shadow would_allow: collect oak_log 6' },
  ],
});

test('builder output passes boundary validation', () => {
  const req = buildOverseerRequest(SNAPSHOT);
  const check = validateOverseerRequest(req);
  assert.equal(check.ok, true);
});

test('request carries redacted manifest, never raw chat or secrets', () => {
  const req = buildOverseerRequest({ ...SNAPSHOT, chatLog: ['secret stuff'], rcon: 'x' });
  assert.ok(!('chatLog' in req));
  assert.ok(!('rawChat' in req));
  assert.ok(!('rcon' in req));
  assert.ok(!('credentials' in req));
  assert.equal(req.manifest.length, 2);
  assert.equal(validateOverseerRequest(req).ok, true);
});

test('safety summary reflects recovery counts from vitals', () => {
  const req = buildOverseerRequest(SNAPSHOT);
  assert.match(req.safetySummary, /1 recovery/);
  assert.match(req.safetySummary, /1 clear/);
});

test('long goals truncate and receipts cap at twenty', () => {
  const req = buildOverseerRequest({
    ...SNAPSHOT,
    goal: 'x'.repeat(900),
    records: Array.from({ length: 40 }, (_, i) => ({ source: 'Steve', summary: `r${i}` })),
  });
  assert.ok(req.goal.length <= 500);
  assert.equal(req.receipts.length, 20);
  assert.equal(validateOverseerRequest(req).ok, true);
});

test('empty snapshot still builds a valid request', () => {
  const req = buildOverseerRequest({});
  assert.equal(validateOverseerRequest(req).ok, true);
  assert.deepEqual(req.memories, []);
});

test('controller-shaped minions without an online flag count from vitals', () => {
  const req = buildOverseerRequest({
    goalVersion: 1,
    minions: [
      { name: 'Steve', role: 'planner', paused: false, ticks: 60 },
      { name: 'Moss', role: 'farmer', paused: false, ticks: 55 },
    ],
    vitals: { Steve: { health: 20, food: 20 }, Moss: { health: 20, food: 20 } },
    records: [],
  });
  assert.match(req.safetySummary, /2 clear/);
  assert.equal(validateOverseerRequest(req).ok, true);
});
