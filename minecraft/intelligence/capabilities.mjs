export const CAPABILITIES = Object.freeze({
  'team.read': { tier: 1, roles: ['all'], mode: 'read' },
  'team.request_help': { tier: 1, roles: ['all'], mode: 'execute' },
  'work_order.claim': { tier: 1, roles: ['all'], mode: 'execute' },
  'skill.run': { tier: 1, roles: ['all'], mode: 'execute' },
  'hazard.report': { tier: 1, roles: ['all', 'scout'], mode: 'execute' },
  'depot.transfer': { tier: 1, roles: ['builder', 'farmer', 'miner'], mode: 'execute' },
  'build_card.propose': { tier: 2, roles: ['foreman', 'overseer'], mode: 'propose' },
  'build_card.execute': { tier: 1, roles: ['builder'], mode: 'execute' },
  'hermes.research_request': { tier: 2, roles: ['overseer'], mode: 'propose' },
  'skill.propose': { tier: 2, roles: ['foreman', 'overseer'], mode: 'propose' },
  'build_footprint.propose': { tier: 3, roles: ['foreman', 'overseer'], mode: 'propose' },
  'model_profile.propose': { tier: 3, roles: ['overseer'], mode: 'propose' },
});

export function capabilityFor(name) {
  return CAPABILITIES[name] || null;
}
