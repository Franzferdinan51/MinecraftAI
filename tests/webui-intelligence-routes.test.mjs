import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../webui/server.mjs', import.meta.url), 'utf8');

test('Mission Control proxies observe-only intelligence records', () => {
  assert.match(source, /url\.pathname === '\/api\/intelligence'/);
  assert.match(source, /botFetch\(3003, '\/intelligence'/);
  assert.match(source, /url\.pathname === '\/api\/intelligence\/proposal'/);
  assert.match(source, /botFetch\(3003, '\/intelligence\/proposal'/);
});

test('Mission Control intelligence route cannot queue bot commands', () => {
  const start = source.indexOf("url.pathname === '/api/intelligence'");
  assert.notEqual(start, -1);
  const end = source.indexOf("url.pathname === '/api/team'", start);
  const section = source.slice(start, end);
  assert.doesNotMatch(section, /\/queue/);
  assert.doesNotMatch(section, /\/say/);
});
