/**
 * Browser Handler Tests — drive the REAL navigate / wait / browser_close
 * handlers through executeTool() with a mocked page in global state.
 * (browser_init is excluded: it launches a real browser — covered by
 * test/e2e-tools.mjs against the live server.)
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { createMockBrowser, createMockPage } from '../mocks/browser-mocks.mjs';

const require = createRequire(import.meta.url);
const { executeTool } = require('../../dist/src/mcp/handlers/index.js');
const { state } = require('../../dist/src/mcp/handlers/state.js');

let page;
let browser;

before(() => {
  page = createMockPage();
  browser = createMockBrowser();
  state.browserInstance = browser;
  state.pageInstance = page;
  state.setupPageFn = null;
});

after(() => {
  state.browserInstance = null;
  state.pageInstance = null;
  state.setupPageFn = null;
});

// ─── navigate ───────────────────────────────────────────────────────────────
test('navigate: successfully navigates (real handler)', async () => {
  const res = await executeTool('navigate', {
    url: 'https://example.com', waitUntil: 'domcontentloaded', timeout: 5000, retries: 0, smartWait: false,
  });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.match(res.url || '', /example\.com/);
});

test('navigate: rejects private/loopback targets (SSRF guard)', async () => {
  const res = await executeTool('navigate', { url: 'http://127.0.0.1:9999/', retries: 0 });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /blocked|private/i);
});

test('navigate: rejects malformed URLs (real handler)', async () => {
  const res = await executeTool('navigate', { url: 'not a url', retries: 0 });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Invalid URL|blocked/i);
});

test('navigate: validation requires url (real handler)', async () => {
  const res = await executeTool('navigate', {});
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Missing required parameter: url/);
});

// ─── wait ───────────────────────────────────────────────────────────────────
test('wait: fixed timeout (real handler)', async () => {
  const res = await executeTool('wait', { type: 'timeout', value: '200' });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.type, 'timeout');
});

test('wait: selector found (real handler)', async () => {
  page._addElement('#app-ready', {});
  const res = await executeTool('wait', { type: 'selector', value: '#app-ready', timeout: 2000 });
  assert.strictEqual(res.success, true, JSON.stringify(res));
});

test('wait: selector not found returns clean error (real handler)', async () => {
  const res = await executeTool('wait', { type: 'selector', value: '#never', timeout: 100 });
  assert.strictEqual(res.success, false);
});

// ─── browser_close ──────────────────────────────────────────────────────────
test('browser_close: releases state (real handler)', async () => {
  assert.ok(state.browserInstance, 'browser should be set before close');
  const res = await executeTool('browser_close', {});
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(state.browserInstance, null, 'state should be cleared after close');
  assert.strictEqual(state.pageInstance, null);
});

test('browser_close: force kill fallback when graceful close fails (real handler)', async () => {
  state.browserInstance = {
    close: async () => { throw new Error('crash'); },
    process: () => ({ kill: () => {} }),
  };
  state.pageInstance = page;
  const res = await executeTool('browser_close', { force: true });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(state.browserInstance, null);
});
