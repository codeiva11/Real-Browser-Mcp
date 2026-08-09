/**
 * E2E Tool Test — launches the real MCP server over STDIO and drives a
 * headless browser through the actual tools (browser_init → navigate →
 * get_content → extract_data → see_page → browser_close).
 *
 * This is the missing runtime integration layer: mcp-smoke.mjs only verifies
 * the registry, while this verifies the tools actually execute end-to-end
 * against the core SDK. Requires the Patchright Chromium binary (installed by
 * `postinstall` or `npx patchright install chromium`).
 *
 * Run: npm run e2e_test   (builds first)
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import test from 'node:test';
import * as path from 'node:path';
import * as url from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'src', 'mcp', 'index.js');

/** Minimal JSON-RPC client over stdio. */
function createClient() {
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HEADLESS: 'true', REAL_BROWSER_LOG_LEVEL: 'error' },
  });

  let buf = '';
  let id = 0;
  const pending = new Map();

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? p.reject(new Error(`${p.name}: ${JSON.stringify(msg.error)}`)) : p.resolve(msg.result);
        }
      } catch { /* partial line */ }
    }
  });

  const send = (method, params = {}) => {
    const msg = { jsonrpc: '2.0', id: ++id, method, params };
    proc.stdin.write(JSON.stringify(msg) + '\n');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, name: method });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
      }, 90000);
    });
  };

  return { proc, send };
}

async function callTool(client, name, args) {
  const res = await client.send('tools/call', { name, arguments: args });
  const text = res.content?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { success: false, raw: text }; }
  return { ...res, parsed };
}

test('E2E: full tool flow over STDIO against a real headless browser', { timeout: 180000 }, async () => {
  const client = createClient();

  try {
    const init = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-tools-test', version: '1.0.0' },
    });
    assert.ok(init.serverInfo, 'initialize handshake failed');
    client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    // browser_init
    const r1 = await callTool(client, 'browser_init', { headless: true, enableBlocker: false });
    assert.strictEqual(r1.parsed.success, true, `browser_init failed: ${r1.parsed.error}`);

    // navigate
    const r2 = await callTool(client, 'navigate', { url: 'https://example.com', waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.strictEqual(r2.parsed.success, true, `navigate failed: ${r2.parsed.error}`);
    assert.match(r2.parsed.url || '', /example\.com/, 'navigate did not land on example.com');

    // get_content (text)
    const r3 = await callTool(client, 'get_content', { format: 'text' });
    assert.strictEqual(r3.parsed.success, true, `get_content failed: ${r3.parsed.error}`);
    assert.ok((r3.parsed.content || '').length > 0, 'get_content returned empty content');

    // extract_data (meta)
    const r4 = await callTool(client, 'extract_data', { type: 'meta' });
    assert.strictEqual(r4.parsed.success, true, `extract_data failed: ${r4.parsed.error}`);
    assert.strictEqual(r4.parsed.extracted?.title, 'Example Domain', 'extract_data meta title mismatch');

    // see_page returns an image + text summary
    const r5 = await callTool(client, 'see_page', { includePageText: true, maxElements: 10 });
    assert.ok(r5.content?.[0]?.data, 'see_page did not return an image');
    assert.strictEqual(r5.content?.[0]?.mimeType, 'image/jpeg', 'see_page image mimeType mismatch');

    // wait
    const r6 = await callTool(client, 'wait', { type: 'timeout', value: '300' });
    assert.strictEqual(r6.parsed.success, true, `wait failed: ${r6.parsed.error}`);

    // negative path: tool before browser is closed still errors cleanly
    const r7 = await callTool(client, 'browser_close', {});
    assert.strictEqual(r7.parsed.success, true, `browser_close failed: ${r7.parsed.error}`);
  } finally {
    client.proc.kill();
  }
});

test('E2E: SSRF guard blocks private targets through navigate', { timeout: 90000 }, async () => {
  const client = createClient();
  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-ssrf-test', version: '1.0.0' },
    });
    client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    await callTool(client, 'browser_init', { headless: true, enableBlocker: false });

    const r = await callTool(client, 'navigate', { url: 'http://127.0.0.1:9999/', timeout: 5000 });
    assert.strictEqual(r.isError, true, 'private navigate should be isError');
    assert.match(r.parsed.error || '', /blocked|private/i, 'error should mention blocking');
  } finally {
    client.proc.kill();
  }
});
