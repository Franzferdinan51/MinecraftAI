// Bounded three-scope team memory. Pure in-memory store: episodic
// (expiring task results/hazards), semantic (durable corroborated facts),
// procedural (learned cards, inactive until player-approved elsewhere).
// Never accepts raw prompts, chain-of-thought, credentials, or chat logs.

const TRUSTED_SOURCES = new Set(['verified_receipt', 'trusted_observation']);
const BANNED_KEYS = ['prompt', 'chainOfThought', 'reasoning', 'credentials', 'chatLog'];
const MAX_SUMMARY = 300;
const MAX_RECEIPTS = 8;

export function createMemoryStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const episodicMax = Number.isInteger(options.episodicMax) ? options.episodicMax : 200;
  const episodicTtlMs = Number.isInteger(options.episodicTtlMs)
    ? options.episodicTtlMs
    : 6 * 60 * 60 * 1000;
  const contextQuota = Number.isInteger(options.contextQuota) ? options.contextQuota : 5;

  const scopes = { episodic: [], semantic: [], procedural: [] };

  function sanitize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    for (const key of BANNED_KEYS) if (key in input) return null;
    if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 80) return null;
    if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > MAX_SUMMARY) return null;
    if (typeof input.bot !== 'string' || !input.bot.trim()) return null;
    const receipts = Array.isArray(input.receipts) ? input.receipts.slice(0, MAX_RECEIPTS) : [];
    if (!receipts.every((r) => typeof r === 'string')) return null;
    return Object.freeze({
      id: input.id.trim(), bot: input.bot.trim(),
      kind: typeof input.kind === 'string' ? input.kind.slice(0, 40) : 'note',
      summary: input.summary.trim(), receipts: Object.freeze(receipts),
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
    });
  }

  function record(input) {
    const entry = sanitize(input);
    if (!entry) return Object.freeze({ ok: false, error: 'invalid_entry' });
    if (!TRUSTED_SOURCES.has(input.source)) return Object.freeze({ ok: false, error: 'untrusted_source' });
    const stamped = Object.freeze({
      ...entry, createdAt: now(), expiresAt: now() + episodicTtlMs,
    });
    scopes.episodic.push(stamped);
    while (scopes.episodic.length > episodicMax) scopes.episodic.shift();
    return Object.freeze({ ok: true, entry: stamped });
  }

  function promoteToSemantic(id, evidence = {}) {
    const index = scopes.episodic.findIndex((e) => e.id === id);
    if (index === -1) return Object.freeze({ ok: false, error: 'unknown_entry' });
    if (!evidence.corroborated && !evidence.playerConfirmed) {
      return Object.freeze({ ok: false, error: 'needs_corroboration' });
    }
    const [entry] = scopes.episodic.splice(index, 1);
    const fact = Object.freeze({ ...entry, expiresAt: null, promotedAt: now() });
    scopes.semantic.push(fact);
    return Object.freeze({ ok: true, entry: fact });
  }

  function pruneExpired() {
    const t = now();
    const before = scopes.episodic.length;
    scopes.episodic = scopes.episodic.filter((e) => e.expiresAt > t);
    return before - scopes.episodic.length;
  }

  function list(scope) {
    return Object.freeze([...(scopes[scope] || [])]);
  }

  function contextFor(bot) {
    const memories = [...scopes.semantic, ...scopes.episodic]
      .filter((e) => e.bot === bot || e.bot === 'team')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, contextQuota)
      .map((e) => Object.freeze({ id: e.id, kind: e.kind, summary: e.summary }));
    return Object.freeze({ bot, memories: Object.freeze(memories) });
  }

  return Object.freeze({ record, promoteToSemantic, pruneExpired, list, contextFor });
}
