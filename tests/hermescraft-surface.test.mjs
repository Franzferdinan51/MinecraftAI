import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hc = join(root, 'minecraft/hermescraft');
const read = (p) => readFileSync(p, 'utf8');

const skills = [
  'minecraft-building',
  'minecraft-combat',
  'minecraft-farming',
  'minecraft-navigation',
  'minecraft-survival',
];
const landfolk = ['steve', 'reed', 'moss', 'flint', 'ember', 'duckbot'];

test('hermescraft core: all skills vendored with attribution', () => {
  for (const s of skills) {
    const p = join(hc, `skills/${s}.md`);
    assert.ok(existsSync(p), `missing ${p}`);
    const body = read(p);
    assert.match(body, /bigph00t\/hermescraft/, `${s} lacks upstream attribution`);
    assert.match(body, /\(MIT/, `${s} lacks license marker`);
  }
});

test('hermescraft core: all landfolk cards present, player-neutral', () => {
  for (const l of landfolk) {
    const p = join(hc, `landfolk/${l}.md`);
    assert.ok(existsSync(p), `missing ${p}`);
    const body = read(p);
    assert.ok(body.length > 500, `${l} suspiciously short`);
    assert.doesNotMatch(body, /HermesBot/, `${l} still references old leader name`);
  }
  // Upstream-named cards keep attribution; duckbot is ours.
  for (const l of landfolk.filter((x) => x !== 'duckbot')) {
    assert.match(read(join(hc, `landfolk/${l}.md`)), /bigph00t\/hermescraft/, `${l} lacks attribution`);
  }
  // No hardcoded player username in adapted cards.
  for (const l of landfolk) {
    assert.doesNotMatch(read(join(hc, `landfolk/${l}.md`)), /Alex/, `${l} still hardcodes upstream player name`);
  }
});

test('hermescraft core: shared contract + readme + roster agree', () => {
  assert.ok(existsSync(join(hc, 'SOUL-landfolk.md')));
  assert.ok(existsSync(join(hc, 'README.md')));
  const soul = read(join(hc, 'SOUL-landfolk.md'));
  assert.match(soul, /contracts\.mjs/, 'SOUL does not point at machine-enforced contracts');
  for (const port of ['3001', '3011', '3012', '3013', '3014', '3015']) {
    assert.ok(soul.includes(port), `SOUL missing body port ${port}`);
  }
  const ag = read(join(root, 'hermes-overseer/AGENTS.md'));
  for (const name of ['DuckBot', 'Steve', 'Reed', 'Moss', 'Flint', 'Ember']) {
    assert.ok(ag.includes(name), `fleet roster missing ${name}`);
  }
});
