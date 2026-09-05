// Tests that the WebUI exposes observe-only intelligence reads and that
// the front-end uses them safely. The rewritten dashboard renders the
// ledger in the "Intelligence" pane (not in a "dashboard" tab), so the
// old renderDashIntel/* bindings now live under different names.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../webui/server.mjs', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../webui/public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../webui/public/app.js', import.meta.url), 'utf8');

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
  assert.notEqual(end, -1);
  const section = source.slice(start, end);
  assert.doesNotMatch(section, /\/queue/);
  assert.doesNotMatch(section, /\/say/);
});

test('dashboard exposes the intelligence ledger pane', () => {
  assert.match(html, /data-pane="intelligence"|data-view="intelligence"/);
  assert.match(html, /id="intel-list"|Intelligence ledger/);
});

test('app.js renders the ledger via refreshIntelligence and never queues from it', () => {
  assert.match(app, /async function refreshIntelligence|function refreshIntelligence/);
  assert.match(app, /\/api\/intelligence/);
  // The ledger function is fetch-only and must never POST a queue action.
  const ledgerStart = app.indexOf('async function refreshIntelligence');
  assert.notEqual(ledgerStart, -1);
  const slice = app.slice(ledgerStart, ledgerStart + 4000);
  assert.doesNotMatch(slice, /fetchJSON[^,]*['"][^'"]*\/queue/);
});

test('safety list is read-only', () => {
  // refreshSafety renders the right-rail safety panel without ever
  // issuing a write endpoint.
  const safetyStart = app.indexOf('async function refreshSafety');
  assert.notEqual(safetyStart, -1);
  const slice = app.slice(safetyStart, safetyStart + 4000);
  assert.match(slice, /fleet/);
  assert.doesNotMatch(slice, /fetchJSON[^,]*['"][^'"]*\/queue/);
});

test('intelligence proposal endpoint requires explicit source + content fields', () => {
  // Proposers are not silently accepted: server validates the payload.
  const section = source.slice(source.indexOf("'/api/intelligence/proposal'"), source.indexOf("'/api/team'"));
  assert.match(section, /need \{source, content\}/);
});
