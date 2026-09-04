import { parseProposalEnvelope } from './model-protocol.mjs';
import { evaluateProposal } from './policy.mjs';

function sanitizeDecision(decision) {
  return Object.freeze({
    id: decision.proposal?.id || null,
    bot: decision.proposal?.bot || null,
    capability: decision.proposal?.capability || null,
    skill: decision.proposal?.skill || null,
    riskTier: decision.proposal?.riskTier || null,
    accepted: decision.accepted,
    dispatch: decision.dispatch,
    reason: decision.reason,
  });
}

export function createIntelligenceJournal({ limit = 100, now = Date.now } = {}) {
  const records = [];
  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));

  function retain(record) {
    records.push(Object.freeze(record));
    while (records.length > boundedLimit) records.shift();
    return records.at(-1);
  }

  return Object.freeze({
    recordModelOutput({ source, content, mode = 'observe', policy = {} }) {
      const at = now();
      const parsed = parseProposalEnvelope(content);
      if (!parsed.ok) return retain({ at, source: String(source || 'unknown').slice(0, 40), status: 'rejected', error: parsed.error, decisions: [] });
      const decisions = parsed.value.proposals.map((proposal) => sanitizeDecision(evaluateProposal(proposal, { ...policy, mode })));
      return retain({
        at,
        source: String(source || 'unknown').slice(0, 40),
        status: 'accepted',
        summary: parsed.value.summary,
        decisions: Object.freeze(decisions),
      });
    },
    list() {
      return Object.freeze([...records]);
    },
    recordShadow({ source, action, verdict, reasons = [], recoveryAction = null }) {
      const at = now();
      return retain({
        at,
        source: String(source || 'unknown').slice(0, 40),
        status: 'shadow',
        summary: `shadow ${String(verdict || 'unknown').slice(0, 24)}: ${String(action || '').slice(0, 120)}`,
        verdict: String(verdict || 'unknown').slice(0, 24),
        reasons: Object.freeze((Array.isArray(reasons) ? reasons : []).map((r) => String(r).slice(0, 40))),
        recoveryAction: recoveryAction == null ? null : String(recoveryAction).slice(0, 24),
        decisions: Object.freeze([]),
      });
    },
  });
}
