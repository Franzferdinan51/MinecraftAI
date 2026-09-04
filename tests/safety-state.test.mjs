import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveSafetyState, THRESHOLDS } from '../minecraft/intelligence/safety-state.mjs';

const HEALTHY = Object.freeze({ health: 20, food: 20, deaths: 0, recentDeaths: 0 });

test('healthy vitals clear the bot for work', () => {
  const state = deriveSafetyState({ ...HEALTHY });
  assert.equal(state.hold, false);
  assert.equal(state.inRecovery, false);
  assert.deepEqual(state.reasons, []);
  assert.equal(state.recoveryAction, null);
  assert.equal(state.severity, 'ok');
});

test('low health with food routes recovery through eating', () => {
  const state = deriveSafetyState({ health: 7.3, food: 16, deaths: 10, recentDeaths: 0 });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, true);
  assert.ok(state.reasons.includes('low_health'));
  assert.equal(state.recoveryAction, 'eat');
  assert.equal(state.severity, 'critical');
});

test('low health without food routes recovery through resupply', () => {
  const state = deriveSafetyState({ health: 7.3, food: 0, deaths: 10, recentDeaths: 0 });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, true);
  assert.ok(state.reasons.includes('low_health'));
  assert.ok(state.reasons.includes('no_food'));
  assert.equal(state.recoveryAction, 'resupply');
});

test('disconnected bot is held without entering recovery', () => {
  const state = deriveSafetyState({ ...HEALTHY, connected: false });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, false);
  assert.ok(state.reasons.includes('disconnected'));
  assert.equal(state.recoveryAction, null);
});

test('death streak holds the bot and forces regroup', () => {
  const state = deriveSafetyState({ ...HEALTHY, deaths: 37, recentDeaths: 3 });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, true);
  assert.ok(state.reasons.includes('death_streak'));
  assert.equal(state.recoveryAction, 'regroup');
});

test('water exposure holds the bot for dry-ground regroup', () => {
  const state = deriveSafetyState({ ...HEALTHY, inWater: true });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, true);
  assert.ok(state.reasons.includes('in_water'));
  assert.equal(state.recoveryAction, 'regroup');
});

test('hostiles near a weakened bot hold it; full-health bot is unaffected', () => {
  const weak = deriveSafetyState({ health: 12, food: 18, hostilesNearby: true });
  assert.equal(weak.hold, true);
  assert.ok(weak.reasons.includes('hostiles_nearby'));

  const strong = deriveSafetyState({ ...HEALTHY, hostilesNearby: true });
  assert.equal(strong.hold, false);
});

test('stuck movement holds the bot for regroup', () => {
  const state = deriveSafetyState({ ...HEALTHY, stuck: true });
  assert.equal(state.hold, true);
  assert.ok(state.reasons.includes('stuck'));
  assert.equal(state.recoveryAction, 'regroup');
});

test('controller pause holds the bot without recovery', () => {
  const state = deriveSafetyState({ ...HEALTHY, paused: true });
  assert.equal(state.hold, true);
  assert.equal(state.inRecovery, false);
  assert.ok(state.reasons.includes('paused'));
});

test('missing vitals fail closed', () => {
  const state = deriveSafetyState({});
  assert.equal(state.hold, true);
  assert.ok(state.reasons.includes('unknown_vitals'));
});

test('thresholds are published and frozen', () => {
  assert.ok(Object.isFrozen(THRESHOLDS));
  assert.equal(THRESHOLDS.criticalHealth, 8);
  assert.equal(THRESHOLDS.lowFood, 6);
  assert.equal(THRESHOLDS.deathStreak, 3);
});
