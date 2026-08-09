/**
 * Dispatch Pipeline Tests — exercise the REAL executeTool() router:
 * unknown-tool handling, schema validation, and watchdog timeout behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

// Shrink the watchdog budget so the timeout test is fast. Must be set BEFORE
// handlers/index.js is loaded (TOOL_TIMEOUT_MS is read at module init).
process.env.REAL_BROWSER_TOOL_TIMEOUT_MS = '300';

const require = createRequire(import.meta.url);
const { executeTool } = require('../../dist/src/mcp/handlers/index.js');

test('dispatch: unknown tool returns clean error', async () => {
  const res = await executeTool('does_not_exist', {});
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /not implemented/);
});

test('dispatch: schema validation rejects wrong enum values', async () => {
  const res = await executeTool('get_content', { format: 'xml' });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /must be one of/);
});

test('dispatch: schema validation rejects wrong types', async () => {
  const res = await executeTool('navigate', { url: 12345 });
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /must be a string/);
});

test('dispatch: watchdog rejects a hung handler', async () => {
  // Inject a handler that never resolves; the watchdog must reject it.
  const { handlers } = require('../../dist/src/mcp/handlers/index.js');
  const original = handlers._test_hang;
  handlers._test_hang = () => new Promise(() => { /* never resolves */ });
  try {
    const res = await executeTool('_test_hang', {});
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /timed out after/i);
  } finally {
    if (original) handlers._test_hang = original;
    else delete handlers._test_hang;
  }
});
