import { normalizeProposal } from './contracts.mjs';

const MAX_PROPOSALS = 6;
const MAX_SUMMARY = 500;

function invalid(error) {
  return Object.freeze({ ok: false, error });
}

export function parseProposalEnvelope(content) {
  if (typeof content !== 'string' || !content.trim()) return invalid('empty_output');
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    return invalid('invalid_json');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('invalid_envelope');
  if (raw.schemaVersion !== 1) return invalid('unsupported_schema');
  if (typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > MAX_SUMMARY) return invalid('invalid_summary');
  if (!Array.isArray(raw.proposals)) return invalid('invalid_proposals');
  if (raw.proposals.length > MAX_PROPOSALS) return invalid('too_many_proposals');
  if (!Array.isArray(raw.helpRequests) || !Array.isArray(raw.memoryCandidates)) return invalid('invalid_side_channels');

  const proposals = [];
  for (const proposal of raw.proposals) {
    const normalized = normalizeProposal(proposal);
    if (!normalized.ok) return invalid('invalid_proposal');
    proposals.push(normalized.value);
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: 1,
      summary: raw.summary.trim(),
      proposals: Object.freeze(proposals),
      helpRequests: Object.freeze(raw.helpRequests.slice(0, MAX_PROPOSALS)),
      memoryCandidates: Object.freeze(raw.memoryCandidates.slice(0, MAX_PROPOSALS)),
    }),
  });
}
