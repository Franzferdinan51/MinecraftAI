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

const appSource = fs.readFileSync(new URL('../webui/public/app.js', import.meta.url), 'utf8');

test('dashboard renders the observe-only intelligence ledger', () => {
  assert.match(appSource, /dash-intel/);
  assert.match(appSource, /\/api\/intelligence/);
  assert.match(appSource, /function renderDashIntel/);
});

test('dashboard ledger never submits proposals or queues actions', () => {
  const start = appSource.indexOf('function renderDashIntel');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('// ── dashboard: queue maintenance ──', start);
  assert.notEqual(end, -1);
  const section = appSource.slice(start, end);
  assert.doesNotMatch(section, /intelligence\/proposal/);
  assert.doesNotMatch(section, /\/api\/queue/);
  assert.doesNotMatch(section, /POST/);
});
