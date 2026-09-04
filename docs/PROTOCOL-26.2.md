# Minecraft 26.2 protocol warnings (protodef short reads)

Custom protocol fork behind the Mineflayer bots does not fully decode
three newer packet shapes. This is captured evidence, not a diagnosis
from memory — see `minecraft/protocol/fixtures-26.2.json` for verbatim
buffers.

## Signatures

1. **`entity_metadata` + `sonic_boom`** (most frequent) — `Chunk size
   is 21 but only 17 was read`. Warden sonic-boom particle metadata
   (key 10) alongside float health (key 9). Exact buffers captured.
2. **`packet_explosion` → `ExplosionParticleEntry`** —
   `Unexpected buffer end while reading VarInt`. Stack passes through
   the compiled `ExplosionParticleEntry` reader.
3. **`packet_world_particles`** — `PartialReadError` inside the
   world-particles decoder.

## Impact (verified repeatedly)

Recoverable warnings. Every investigated bot stayed connected and
API-healthy (`/health` 200, correct vitals). Treat watcher alerts as
verify-first incidents, never as crash evidence: check API health,
controller state, game connection, and death counts before acting.

## Remediation direction (not yet started)

- Fixture-first: replay the captured buffers against candidate
  decoder fixes offline — never debug on the live fleet.
- One-bot canary for any protocol change; never blanket-update the
  custom 26.2 stack to upstream npm latest.
- v1 of any fix must keep all existing bots connected; rollback is
  the previous bot checkout.
