// Deterministic bot safety state (powers plan, Task 8 prerequisite).
// Pure derivation of hold/recovery status from a vitals snapshot — the
// feeder for the authority gateway's `ctx.botState[bot].inRecovery` flag,
// which until now had no deterministic producer. Recovery always outranks
// model plans. No I/O, no dispatch, no side effects.
//
// Tunables reflect observed fleet reality: bots seen stranded at 7.3/20
// health, empty inventories blocking `mc eat`, and water/hostile death
// loops behind 100+ fleet deaths. Thresholds can be overridden per call
// via `options.thresholds` without changing the defaults.

export const THRESHOLDS = Object.freeze({
  criticalHealth: 8,
  lowFood: 6,
  deathStreak: 3,
  hostileHealth: 14,
});

const ACTION_PRIORITY = ['eat', 'resupply', 'regroup'];

export function deriveSafetyState(vitals = {}, options = {}) {
  const t = { ...THRESHOLDS, ...(options.thresholds || {}) };
  const reasons = [];
  const actions = new Set();
  let inRecovery = false;

  const health = vitals.health;
  const food = vitals.food;
  if (!Number.isFinite(health) || !Number.isFinite(food)) {
    return Object.freeze({
      hold: true,
      inRecovery: false,
      reasons: Object.freeze(['unknown_vitals']),
      recoveryAction: null,
      severity: 'critical',
    });
  }

  // Fail-closed holds: the bot must not receive model-planned work.
  if (vitals.paused === true) reasons.push('paused');
  if (vitals.connected === false) reasons.push('disconnected');

  const recentDeaths = Number.isFinite(vitals.recentDeaths) ? vitals.recentDeaths : 0;
  if (recentDeaths >= t.deathStreak) {
    reasons.push('death_streak');
    inRecovery = true;
    actions.add('regroup');
  }

  if (health <= t.criticalHealth) {
    reasons.push('low_health');
    inRecovery = true;
    if (food <= 0) {
      reasons.push('no_food');
      actions.add('resupply');
    } else {
      actions.add('eat');
    }
  } else if (food <= t.lowFood) {
    reasons.push('low_food');
    inRecovery = true;
    actions.add(food <= 0 ? 'resupply' : 'eat');
  }

  if (vitals.inWater === true) {
    reasons.push('in_water');
    inRecovery = true;
    actions.add('regroup');
  }

  if (vitals.stuck === true) {
    reasons.push('stuck');
    inRecovery = true;
    actions.add('regroup');
  }

  if (vitals.hostilesNearby === true && health <= t.hostileHealth) {
    reasons.push('hostiles_nearby');
  }

  const hold = reasons.length > 0;
  const recoveryAction = ACTION_PRIORITY.find((a) => actions.has(a)) || null;
  const severity = inRecovery ? 'critical' : hold ? 'caution' : 'ok';

  return Object.freeze({
    hold,
    inRecovery,
    reasons: Object.freeze([...reasons]),
    recoveryAction,
    severity,
  });
}
