#!/usr/bin/env node
/**
 * MCP Smoke Test — network-independent, fast.
 *
 * Spawns the MCP server over STDIO exactly like a real client (Cline/Claude),
 * performs the JSON-RPC handshake, and verifies:
 *   1. STDOUT carries ONLY clean JSON-RPC (no banner/log contamination)
 *   2. `initialize` returns valid serverInfo (name + version from package.json)
 *   3. `tools/list` returns all expected tools with valid schemas
 *   4. Tool definitions match src/shared/tools.js (count + names)
 *   5. Every tool in the registry has a handler implementation
 *
 * This does NOT launch a browser, so it runs in milliseconds and in CI.
 * Exit code 0 = all pass, 1 = failure.
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'src', 'index.js');
const { TOOLS } = require(path.join(ROOT, 'src', 'shared', 'tools.js'));
const { handlers } = require(path.join(ROOT, 'src', 'mcp', 'handlers.js'));
const PKG = require(path.join(ROOT, 'package.json'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  \u2705 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u274c ${name}\n     ${e.message}`);
    failed++;
  }
}

function rpc(child, obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

async function main() {
  console.log('\n\ud83e\uddea MCP Smoke Test (no browser)\n');

  // --- Static checks (no spawn needed) ---
  console.log('Static checks:');
  check('every registered tool has a handler', () => {
    const missing = TOOLS.filter(t => typeof handlers[t.name] !== 'function').map(t => t.name);
    assert.strictEqual(missing.length, 0, `missing handlers: ${missing.join(', ')}`);
  });
  check('every tool has name + inputSchema', () => {
    const bad = TOOLS.filter(t => !t.name || !t.inputSchema || t.inputSchema.type !== 'object');
    assert.strictEqual(bad.length, 0, `invalid tool defs: ${bad.map(t => t.name).join(', ')}`);
  });
  check('no duplicate tool names', () => {
    const names = TOOLS.map(t => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.strictEqual(dupes.length, 0, `duplicates: ${dupes.join(', ')}`);
  });

  // --- Live STDIO handshake ---
  console.log('\nLive STDIO handshake:');
  const child = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HEADLESS: 'true' },
  });

  const responses = {};
  let stdoutBuf = '';
  let nonJsonLines = 0;

  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses[msg.id] = msg;
      } catch (e) {
        nonJsonLines++;
      }
    }
  });

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await wait(1200);
  rpc(child, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-test', version: '1.0.0' } },
  });
  await wait(1200);
  rpc(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await wait(1500);

  child.kill();

  check('STDOUT had zero non-JSON lines (clean JSON-RPC stream)', () => {
    assert.strictEqual(nonJsonLines, 0, `${nonJsonLines} non-JSON line(s) leaked to STDOUT`);
  });
  check('initialize responded', () => {
    assert.ok(responses[1], 'no response for id=1');
    assert.ok(responses[1].result, 'initialize has no result');
  });
  check('serverInfo.name is correct', () => {
    assert.strictEqual(responses[1].result.serverInfo.name, 'real-browser-mcp-server');
  });
  check('serverInfo.version matches package.json', () => {
    assert.strictEqual(responses[1].result.serverInfo.version, PKG.version,
      `server reported ${responses[1].result.serverInfo.version}, package.json is ${PKG.version}`);
  });
  check('tools/list responded', () => {
    assert.ok(responses[2], 'no response for id=2');
    assert.ok(Array.isArray(responses[2].result.tools), 'tools is not an array');
  });
  check(`tools/list returns ${TOOLS.length} tools`, () => {
    assert.strictEqual(responses[2].result.tools.length, TOOLS.length);
  });
  check('tools/list names match registry', () => {
    const live = responses[2].result.tools.map(t => t.name).sort();
    const reg = TOOLS.map(t => t.name).sort();
    assert.deepStrictEqual(live, reg);
  });
  check('every live tool has an inputSchema', () => {
    const bad = responses[2].result.tools.filter(t => !t.inputSchema);
    assert.strictEqual(bad.length, 0, `missing inputSchema: ${bad.map(t => t.name).join(', ')}`);
  });

  console.log(`\n\u2139 passed ${passed}, failed ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});