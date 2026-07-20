/**
 * MCP Smoke Test — Fast, network-independent.
 * Verifies:
 *   1. Tool registry (all 22 tools registered, no duplicates)
 *   2. JSON-RPC initialize handshake over STDIO
 *   3. tools/list response matches registry
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import test from 'node:test';

const require = createRequire(import.meta.url);

// ─── 1. Tool Registry Check ────────────────────────────────────────────────
test('Tool Registry — all tools registered, no duplicates', async () => {
  const { TOOLS } = require('../dist/src/shared/tools.js');
  assert.ok(Array.isArray(TOOLS), 'TOOLS should be an array');
  assert.ok(TOOLS.length >= 22, `Expected >=22 tools, got ${TOOLS.length}`);

  const names = TOOLS.map(t => t.name);
  const unique = new Set(names);
  assert.strictEqual(unique.size, names.length, `Duplicate tool names: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);

  // Required tools must be present
  const required = ['browser_init', 'navigate', 'click', 'type', 'see_page', 'browse_task',
    'get_content', 'extract_data', 'network_recorder', 'media_extractor',
    'deep_analysis', 'execute_js', 'solve_captcha', 'redirect_tracer',
    'replay_request', 'api_analyzer', 'storage_inspector', 'progress_tracker',
    'wait', 'press_key', 'random_scroll', 'browser_close'];

  for (const name of required) {
    assert.ok(unique.has(name), `Missing required tool: ${name}`);
  }

  // Every tool must have required fields
  for (const tool of TOOLS) {
    assert.ok(tool.name, `Tool missing name`);
    assert.ok(tool.description, `Tool ${tool.name} missing description`);
    assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
    assert.ok(tool.category, `Tool ${tool.name} missing category`);
  }

  console.log(`  ✅ ${TOOLS.length} tools registered, all valid`);
});

// ─── 2. Handler Registration — every tool has a handler ───────────────────
test('Handler Registration — every tool has an implementation', async () => {
  const { TOOLS } = require('../dist/src/shared/tools.js');
  const { handlers } = require('../dist/src/mcp/handlers/index.js');

  const toolNames = TOOLS.map(t => t.name);
  const handlerNames = Object.keys(handlers);

  const missing = toolNames.filter(n => !handlers[n]);
  const extra = handlerNames.filter(n => !toolNames.includes(n));

  assert.strictEqual(missing.length, 0, `Tools without handler: ${missing.join(', ')}`);
  assert.strictEqual(extra.length, 0, `Handlers without tool def: ${extra.join(', ')}`);

  console.log(`  ✅ All ${toolNames.length} tools have matching handlers`);
});

// ─── 3. JSON-RPC Initialize Handshake ─────────────────────────────────────
test('JSON-RPC STDIO — initialize handshake', async () => {
  const serverPath = new URL('../dist/src/mcp/index.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HEADLESS: 'true' }
  });

  let stdout = '';
  let resolved = false;

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill(); reject(new Error('Handshake timeout (5s)')); }
    }, 5000);

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.result && msg.result.serverInfo) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              proc.kill();
              resolve(msg);
            }
          }
        } catch { /* not JSON yet */ }
      }
    });

    proc.on('error', err => { clearTimeout(timeout); reject(err); });
    proc.on('close', code => {
      clearTimeout(timeout);
      if (!resolved) reject(new Error(`Server exited with code ${code} before handshake`));
    });

    // Send JSON-RPC initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-smoke-test', version: '1.0.0' }
      }
    }) + '\n';

    setTimeout(() => proc.stdin.write(initRequest), 100);
  });

  assert.ok(result.result.serverInfo, 'serverInfo missing in initialize response');
  assert.ok(result.result.serverInfo.name, 'serverInfo.name missing');
  assert.ok(result.result.capabilities, 'capabilities missing');
  console.log(`  ✅ Handshake OK — server: ${result.result.serverInfo.name} v${result.result.serverInfo.version}`);
});

// ─── 4. JSON-RPC tools/list matches registry ──────────────────────────────
test('JSON-RPC STDIO — tools/list matches registry', async () => {
  const { TOOLS } = require('../dist/src/shared/tools.js');
  const serverPath = new URL('../dist/src/mcp/index.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HEADLESS: 'true' }
  });

  let stdout = '';
  let initialized = false;
  let resolved = false;

  const toolsResult = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill(); reject(new Error('tools/list timeout (8s)')); }
    }, 8000);

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          // After initialize response, send initialized + tools/list
          if (!initialized && msg.result && msg.result.serverInfo) {
            initialized = true;
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          }
          // Capture tools/list response
          if (msg.id === 2 && msg.result && msg.result.tools) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              proc.kill();
              resolve(msg.result.tools);
            }
          }
        } catch { /* not JSON yet */ }
      }
    });

    proc.on('error', err => { clearTimeout(timeout); reject(err); });
    proc.on('close', code => { clearTimeout(timeout); if (!resolved) reject(new Error(`Server exited ${code}`)); });

    // Send initialize
    setTimeout(() => {
      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-smoke-test', version: '1.0.0' }
        }
      }) + '\n');
    }, 100);
  });

  assert.ok(Array.isArray(toolsResult), 'tools/list result should be an array');
  assert.strictEqual(toolsResult.length, TOOLS.length,
    `tools/list returned ${toolsResult.length} tools, registry has ${TOOLS.length}`);

  const registryNames = new Set(TOOLS.map(t => t.name));
  for (const tool of toolsResult) {
    assert.ok(registryNames.has(tool.name), `tools/list returned unknown tool: ${tool.name}`);
    assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema in tools/list response`);
  }

  console.log(`  ✅ tools/list returned ${toolsResult.length} tools — all match registry`);
});
