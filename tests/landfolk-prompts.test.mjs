// Regression test for fleet prompts. Each bot's prompt must declare a chain of
// command and refuse to call the others "minions". Each must name the chat
// routing port that maps to its own body. Steve must NOT describe himself as
// fleet coordinator. DuckBot must NOT call the others "minions".

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const LANDFOLK = path.resolve('minecraft/hermescraft/landfolk');

async function readPrompt(name) {
  return (await fs.readFile(path.join(LANDFOLK, `${name}.md`), 'utf8'));
}

async function exists(name) {
  try { await fs.access(path.join(LANDFOLK, name)); return true; }
  catch { return false; }
}

const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }

test('CHAIN_OF_COMMAND.md exists and names every body', async () => {
  const txt = await fs.readFile(path.join(LANDFOLK, 'CHAIN_OF_COMMAND.md'), 'utf8');
  for (const who of ['DuckBot', 'Steve', 'Reed', 'Moss', 'Flint', 'Ember']) {
    assert.match(txt, new RegExp(who, 'i'), `CHAIN_OF_COMMAND.md must mention ${who}`);
  }
});

test('every landfolk prompt declares a Chain of command section', async () => {
  for (const who of ['duckbot', 'steve', 'reed', 'moss', 'flint', 'ember']) {
    const txt = await readPrompt(who);
    assert.match(txt, /Chain of command/i, `${who}.md missing chain-of-command section`);
  }
});

test('every landfolk prompt names its own body port', async () => {
  const ports = {
    duckbot: '`:3001`',
    steve:   '`:3011`',
    reed:    '`:3012`',
    moss:    '`:3013`',
    flint:   '`:3014`',
    ember:   '`:3015`',
  };
  for (const [who, port] of Object.entries(ports)) {
    const txt = await readPrompt(who);
    assert.match(txt, new RegExp(port.replace(/[`:]/g, '\\$&')),
      `${who}.md must mention its body port ${port}`);
  }
});

test('Steve is NOT framed as fleet coordinator or co-overseer', async () => {
  const txt = await readPrompt('steve');
  assert.doesNotMatch(txt, /co-?overseer/i);
  assert.doesNotMatch(txt, /fleet coordinator/i);
  assert.match(txt, /foreman/i, 'Steve must keep the foreman role on the construction line');
});

test("DuckBot must not call the others 'minions'", async () => {
  const txt = await readPrompt('duckbot');
  // The phrase "minions" should only appear in the rejection language we explicitly wrote.
  const lines = txt.split('\n').filter((line) => /minion/i.test(line));
  for (const line of lines) {
    assert.match(line, /never call the others '?minions'?|not.*call.*minions|must not call|never.*minion/i,
      `Unexpected use of "minion" in DuckBot prompt: ${line}`);
  }
});

test("Other landfolk prompts also avoid 'minion' wording", async () => {
  for (const who of ['steve', 'reed', 'moss', 'flint', 'ember']) {
    const txt = await readPrompt(who);
    assert.doesNotMatch(txt, /\bminions?\b/i, `${who}.md should not use "minion(s)"`);
  }
});

test("Reed + Ember explicitly report to Steve", async () => {
  for (const who of ['reed', 'ember']) {
    const txt = (await readPrompt(who)).replace(/\n/g, ' ');
    assert.match(txt, /Reports to.*Steve/,
      `${who}.md must include "Reports to ... Steve" in the chain-of-command table`);
  }
});

test("Moss + Flint explicitly report to DuckBot (not Steve)", async () => {
  for (const who of ['moss', 'flint']) {
    const txt = await readPrompt(who);
    assert.match(txt, /Reports to.*DuckBot/i,
      `${who}.md must include "Reports to ... DuckBot" in the chain-of-command table`);
    assert.match(txt, /not to Steve|not.*Steve/i,
      `${who}.md must explicitly say "not to Steve"`);
  }
});

test('every prompt mentions the chat router', async () => {
  for (const who of ['duckbot', 'steve', 'reed', 'moss', 'flint', 'ember']) {
    const txt = await readPrompt(who);
    assert.match(txt, /CURRENT_CAST|chat\.js|chat router|direct-address prefix/i,
      `${who}.md must reference the chat routing`);
  }
});

test('steve/flint prompts include honest movement reporting clause', async () => {
  for (const who of ['steve', 'flint']) {
    const txt = await readPrompt(who);
    assert.match(txt, /RCON|status|teleport/i,
      `${who}.md must explain that apparent teleports come from RCON, not bg_goto`);
  }
});

const results = [];
for (const t of TESTS) {
  try { await t.fn(); results.push({ name: t.name, ok: true }); }
  catch (err) { results.push({ name: t.name, ok: false, err: err.message }); }
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ok  ${r.name}`);
  else { failed++; console.log(`  FAIL ${r.name}\n       ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passing`);
if (failed) process.exit(1);
