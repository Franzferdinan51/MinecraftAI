// LM Studio request policy (bridge hardening). Pure failure accounting:
// classify individual terminated generations, count consecutive failures,
// and open a bounded cooldown that skips model calls so the bridge falls
// back to deterministic survival actions instead of hammering a sick
// model server or idling HermesBot for whole ticks. No I/O.

export function isTerminatedError(status, bodyText) {
  return status === 400 && /terminated/i.test(String(bodyText || ''));
}

export function createRequestPolicy({ maxConsecutive = 3, cooldownMs = 60_000, now = () => Date.now() } = {}) {
  let consecutive = 0;
  let coolUntil = 0;

  return {
    recordSuccess() {
      consecutive = 0;
      coolUntil = 0;
    },
    recordFailure() {
      consecutive += 1;
      if (consecutive >= maxConsecutive) coolUntil = now() + cooldownMs;
    },
    shouldSkip() {
      if (now() < coolUntil) return true;
      if (coolUntil !== 0 && now() >= coolUntil) {
        consecutive = 0;
        coolUntil = 0;
      }
      return false;
    },
    state() {
      return { consecutive, cooling: now() < coolUntil };
    },
  };
}
