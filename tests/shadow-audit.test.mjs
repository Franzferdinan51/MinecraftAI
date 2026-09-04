import test from 'node:test';
import assert from 'node:assert/strict';

import { auditAction, MODIFYING_VERBS } from '../minecraft/intelligence/shadow-audit.mjs';

const HOUSE = Object.freeze({ x: 50, y: 63, z: 85, radius: 8 });
const HEALTHY = Object.freeze({ health: 20, food: 20, deaths: 5, recentDeaths: 0 });

test('healthy bot running a distant goto would allow', () => {
  const audit = auditAction({ bot: 'Moss', actionArgs: ['goto_near', '44', '63', '85'], vitals: HEALTHY, house: HOUSE });
  assert.equal(audit.verdict, 'would_allow');
  assert.deepEqual(audit.reasons, []);
  assert.equal(audit.bot, 'Moss');
  assert.match(audit.action, /goto_near/);
});

test('low-health bot would hold for recovery even on harmless chat', () => {
  const audit = auditAction({
    bot: 'Flint', actionArgs: ['chat', 'on my way'],
    vitals: { health: 7.3, food: 16 }, house: HOUSE,
  });
  assert.equal(audit.verdict, 'would_hold');
  assert.ok(audit.reasons.includes('low_health'));
  assert.equal(audit.recoveryAction, 'eat');
});

test('missing vitals would hold instead of allowing blindly', () => {
  const audit = auditAction({ bot: 'Steve', actionArgs: ['goto', '44', '63', '85'], vitals: {}, house: HOUSE });
  assert.equal(audit.verdict, 'would_hold');
  assert.ok(audit.reasons.includes('unknown_vitals'));
});

test('dig inside the protected radius would deny', () => {
  const audit = auditAction({
    bot: 'Reed', actionArgs: ['dig', '51', '63', '86'],
    vitals: HEALTHY, house: HOUSE,
  });
  assert.equal(audit.verdict, 'would_deny');
  assert.ok(audit.reasons.includes('protected_zone'));
});

test('movement inside the protected radius stays allowed', () => {
  const audit = auditAction({
    bot: 'Moss', actionArgs: ['goto', '50', '63', '85'],
    vitals: HEALTHY, house: HOUSE,
  });
  assert.equal(audit.verdict, 'would_allow');
});

test('place_fill outside the radius stays allowed', () => {
  const audit = auditAction({
    bot: 'Reed', actionArgs: ['place_fill', 'stone', '100', '63', '100', '104', '63', '104'],
    vitals: HEALTHY, house: HOUSE,
  });
  assert.equal(audit.verdict, 'would_allow');
});

test('modifying verb list covers world-altering actions only', () => {
  for (const verb of ['dig', 'place', 'place_fill', 'till', 'sow', 'collect']) {
    assert.ok(MODIFYING_VERBS.has(verb), `missing ${verb}`);
  }
  for (const verb of ['goto', 'chat', 'eat', 'look', 'sleep']) {
    assert.ok(!MODIFYING_VERBS.has(verb), `should not flag ${verb}`);
  }
});

test('audit records are frozen', () => {
  const audit = auditAction({ bot: 'Ember', actionArgs: ['look'], vitals: HEALTHY, house: HOUSE });
  assert.ok(Object.isFrozen(audit));
  assert.ok(Object.isFrozen(audit.reasons));
});
