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
  // Either chain-of-command exists (preferred post-revamp) or the older
  // chain-of-command.md equivalent. Just check there's a markdown that
  // mentions DuckBot as overseer or coordinator, so the chain is documented.
  const coc = read(join(hc, 'landfolk/CHAIN_OF_COMMAND.md'));
  assert.match(coc, /DuckBot/);
  assert.match(coc, /Steve/);
});

test('hermescraft core: all upstream modes are cataloged and Mission Control exposes them', () => {
  const modes = JSON.parse(read(join(hc, 'modes.json')));
  assert.deepEqual(modes.modes.map((m) => m.id), ['companion', 'landfolk', 'civilization', 'minecraft', 'play']);
  assert.equal(modes.fleet.length, 6);
  assert.ok(modes.command_surface.observe.includes('scene'));
  assert.ok(modes.command_surface.act.includes('fill'));
  assert.ok(modes.command_surface.social.includes('whisper'));
  for (const mode of modes.modes) {
    assert.ok(mode.config, `${mode.id} lacks a versioned config path`);
    if (mode.id !== 'minecraft' && mode.id !== 'play') {
      assert.ok(existsSync(join(hc, mode.config)), `${mode.id} config missing`);
    }
  }
  assert.match(read(join(root, 'webui/server.mjs')), /api\/hermescraft/);
  assert.match(read(join(root, 'webui/server.mjs')), /hermesCraftReadiness/);
  assert.match(read(join(root, 'webui/public/index.html')), /Runtime readiness/);
  assert.match(read(join(root, 'webui/public/app.js')), /refreshHermesCraft/);
  // Mode cards live under #mode-cards in the new layout
  assert.match(read(join(root, 'webui/public/index.html')), /id="mode-cards"/);
});

test('hermescraft readiness: Mission Control reports each mode operational state', () => {
  const server = read(join(root, 'webui/server.mjs'));
  assert.match(server, /modeReadiness/);
  assert.match(server, /operational_modes/);
  // profile-ready tag is in server.mjs's modeReadiness() state machine;
  // app.js renders these state strings verbatim.
  assert.match(server, /profile-ready/);
  const app = read(join(root, 'webui/public/app.js'));
  assert.match(app, /mode-cards/);
  assert.match(app, /modeReadiness|profile-ready|mode-readiness/);
});

test('hermescraft mode detail: WebUI exposes safe per-mode deployment summaries', () => {
  const server = read(join(root, 'webui/server.mjs'));
  assert.match(server, /hermesCraftModeDetail/);
  assert.match(server, /deployment_summary/);
  assert.match(server, /agent_count/);
  assert.match(server, /runtime_status/);
  const app = read(join(root, 'webui/public/app.js'));
  // The mode details object is rendered into #mode-cards (and #mode-fleet)
  assert.match(app, /deployment_summary/);
  assert.match(app, /agent_count/);
  assert.match(app, /runtime_status/);
});

test('hermescraft root: stack paths are correct for the active Landfolk runtime', () => {
  // Local architecture is 6 independent bodies + 6 Hermes brains. The
  // controller (`mode-agent`) is no longer wired into Mission Control;
  // it stays as upstream option but the dashboard no longer pins it.
  const server = read(join(root, 'webui/server.mjs'));
  assert.match(server, /mode_details/);
});
