import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sourcePath = new URL('../minecraft/minion-controller/minion-controller.mjs', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

test('controller exposes default observe-only intelligence state and proposal intake', () => {
  assert.match(source, /createIntelligenceJournal/);
  assert.match(source, /INTELLIGENCE_MODE/);
  assert.match(source, /req\.method === 'GET' && req\.url === '\/intelligence'/);
  assert.match(source, /req\.method === 'POST' && req\.url === '\/intelligence\/proposal'/);
  assert.match(source, /mode: INTELLIGENCE_MODE/);
});

test('controller does not directly execute a proposal from intelligence intake', () => {
  const start = source.indexOf("req.method === 'POST' && req.url === '/intelligence/proposal'");
  assert.notEqual(start, -1);
  const section = source.slice(start, source.indexOf("req.method === 'POST' && req.url === '/say'", start));
  assert.doesNotMatch(section, /runMinionAction\(/);
  assert.doesNotMatch(section, /callMc\(/);
});
