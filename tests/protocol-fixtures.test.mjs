import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixtures = JSON.parse(fs.readFileSync(
  new URL('../minecraft/protocol/fixtures-26.2.json', import.meta.url), 'utf8',
));

test('fixtures file pins the three known 26.2 failure signatures', () => {
  const ids = fixtures.signatures.map((s) => s.id);
  assert.ok(ids.includes('entity_metadata-sonic_boom'));
  assert.ok(ids.includes('packet_explosion-entry'));
  assert.ok(ids.includes('packet_world_particles'));
});

test('every signature carries replayable evidence', () => {
  for (const sig of fixtures.signatures) {
    assert.ok(sig.packet, `${sig.id} needs a packet name`);
    assert.ok(sig.symptom, `${sig.id} needs the observed symptom`);
    assert.ok(sig.decoder_note, `${sig.id} needs the decoder path note`);
  }
});

test('captured buffers are non-empty even-length hex', () => {
  const boom = fixtures.signatures.find((s) => s.id === 'entity_metadata-sonic_boom');
  assert.ok(boom.samples.length >= 3);
  for (const sample of boom.samples) {
    assert.match(sample.buffer, /^[0-9a-f]+$/);
    assert.equal(sample.buffer.length % 2, 0);
  }
});

test('fixtures contain no player-identifying data', () => {
  const raw = JSON.stringify(fixtures);
  assert.doesNotMatch(raw, /Duckets/i);
  assert.doesNotMatch(raw, /\b\d{1,3}(\.\d{1,3}){3}\b/);
});
