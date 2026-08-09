/**
 * DOM Handler Tests — drive the REAL handlers (dist/src/mcp/handlers) through
 * executeTool() with a mocked browser/page in global state. This verifies the
 * actual implementation (dispatch, validation, healing, retry, caps), not a
 * re-implementation.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { createMockPage } from '../mocks/browser-mocks.mjs';

const require = createRequire(import.meta.url);
const { executeTool } = require('../../dist/src/mcp/handlers/index.js');
const { state } = require('../../dist/src/mcp/handlers/state.js');

let page;

before(() => {
  page = createMockPage();
  state.browserInstance = { close: async () => {}, isConnected: () => true, process: () => null };
  state.pageInstance = page;
  state.aiHealingEnabled = true;
  state.activeAnnotations = {};
});

after(() => {
  state.browserInstance = null;
  state.pageInstance = null;
  state.activeAnnotations = undefined;
});

// ─── click ──────────────────────────────────────────────────────────────────
test('click: successfully clicks element (real handler)', async () => {
  page._addElement('#button', {});
  const res = await executeTool('click', { selector: '#button', humanLike: false, retries: 1 });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.clicked, true);
});

test('click: returns clean error for missing selector (real handler)', async () => {
  const res = await executeTool('click', { selector: '#missing', humanLike: false, retries: 1, timeout: 500 });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Selector not found/i);
});

test('click: resolves annotationId from see_page map (real handler)', async () => {
  page._addElement('#ann-btn', {});
  state.activeAnnotations = { 7: { selector: '#ann-btn', text: 'Go', type: 'button' } };
  const res = await executeTool('click', { annotationId: 7, humanLike: false, retries: 1 });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.selector, '#ann-btn');
});

test('click: rejects unknown annotationId (real handler)', async () => {
  state.activeAnnotations = {};
  const res = await executeTool('click', { annotationId: 99, humanLike: false });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Annotation ID 99 not found/);
});

test('click: schema validation requires selector OR annotationId (real handler)', async () => {
  const res = await executeTool('click', { humanLike: false });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /at least one of/);
});

// ─── type ───────────────────────────────────────────────────────────────────
test('type: types text into input field (real handler)', async () => {
  const input = { value: '' };
  page._addElement('#username', input);
  const res = await executeTool('type', { selector: '#username', text: 'testuser', clear: false });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.textLength, 8);
  assert.strictEqual(input.value, 'testuser');
});

test('type: clears existing text (real handler)', async () => {
  const input = { value: 'oldtext' };
  page._addElement('#email', input);
  const res = await executeTool('type', { selector: '#email', text: 'new@email.com', clear: true });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(input.value, 'new@email.com');
});

test('type: returns clean error when selector not found (real handler)', async () => {
  const res = await executeTool('type', { selector: '#nope', text: 'x', clear: false });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Selector not found/i);
});

test('type: validation requires text (real handler)', async () => {
  const res = await executeTool('type', { selector: '#username' });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Missing required parameter: text/);
});

// ─── random_scroll ──────────────────────────────────────────────────────────
test('random_scroll: scrolls down with direction+amount (real handler)', async () => {
  const res = await executeTool('random_scroll', { direction: 'down', amount: 300, smooth: false });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.direction, 'down');
  assert.strictEqual(res.amount, 300);
});

test('random_scroll: smart direction does not crash on empty page (real handler)', async () => {
  const res = await executeTool('random_scroll', { direction: 'smart', amount: 0, smooth: false });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.ok(['up', 'down'].includes(res.direction));
});

// ─── press_key ──────────────────────────────────────────────────────────────
test('press_key: presses key with modifiers (real handler)', async () => {
  const res = await executeTool('press_key', { key: 'Enter' });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.strictEqual(res.key, 'Enter');
});

test('press_key: caps runaway repeat counts at 100 (real handler)', async () => {
  const presses = [];
  page.keyboard.press = async (k) => { presses.push(k); };
  const res = await executeTool('press_key', { key: 'ArrowDown', count: 5000, humanDelay: false });
  assert.strictEqual(res.success, true);
  assert.strictEqual(presses.length, 100, `expected cap at 100, got ${presses.length}`);
});

test('press_key: validation requires key (real handler)', async () => {
  const res = await executeTool('press_key', {});
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /Missing required parameter: key/);
});
