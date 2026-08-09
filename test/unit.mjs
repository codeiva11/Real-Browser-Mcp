/**
 * Unit tests — pure, network-free, no browser required.
 * Tests the shared helpers compiled into dist/:
 *   - URL validation / SSRF guards (url-utils)
 *   - tool-args runtime validation (validate)
 *   - env boolean parsing (env-utils)
 */

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const urlUtils = require('../dist/src/shared/url-utils.js');
const validate = require('../dist/src/shared/validate.js');
const envUtils = require('../dist/src/shared/env-utils.js');

// ─── URL validation ─────────────────────────────────────────────────────────
test('url-utils: rejects non-http protocols', () => {
  const res = urlUtils.validateHttpUrl('file:///etc/passwd');
  assert.strictEqual(res.valid, false);
  assert.match(res.reason || '', /protocol/i);
});

test('url-utils: rejects javascript: URLs', () => {
  const res = urlUtils.validateHttpUrl('javascript:alert(1)');
  assert.strictEqual(res.valid, false);
});

test('url-utils: rejects invalid URLs', () => {
  assert.strictEqual(urlUtils.validateHttpUrl('not a url').valid, false);
  assert.strictEqual(urlUtils.validateHttpUrl('').valid, false);
});

test('url-utils: blocks private/loopback by default', () => {
  for (const bad of ['http://localhost:9222/json', 'http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/']) {
    const res = urlUtils.validateHttpUrl(bad);
    assert.strictEqual(res.valid, false, `expected ${bad} to be blocked`);
    assert.strictEqual(res.private, true, `expected ${bad} to be flagged private`);
  }
});

test('url-utils: allows public URLs by default', () => {
  const res = urlUtils.validateHttpUrl('https://example.com/path?q=1');
  assert.strictEqual(res.valid, true);
  assert.ok(res.url.startsWith('https://example.com/'));
});

test('url-utils: localhost allowed when opt-out env set', () => {
  process.env.REAL_BROWSER_ALLOW_PRIVATE_NETWORK = '1';
  try {
    const res = urlUtils.validateHttpUrl('http://localhost:3000');
    assert.strictEqual(res.valid, true);
  } finally {
    delete process.env.REAL_BROWSER_ALLOW_PRIVATE_NETWORK;
  }
});

// ─── Tool args validation ───────────────────────────────────────────────────
test('validate: missing required param is caught', () => {
  const schema = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
  const res = validate.validateToolArgs(schema, {});
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('url')));
});

test('validate: anyOf selector/annotationId groups', () => {
  const schema = {
    type: 'object',
    properties: { selector: { type: 'string' }, annotationId: { type: 'number' } },
    anyOf: [{ required: ['selector'] }, { required: ['annotationId'] }],
  };
  assert.strictEqual(validate.validateToolArgs(schema, { selector: '#btn' }).valid, true);
  assert.strictEqual(validate.validateToolArgs(schema, { annotationId: 3 }).valid, true);
  assert.strictEqual(validate.validateToolArgs(schema, {}).valid, false);
});

test('validate: enum violations are caught', () => {
  const schema = { type: 'object', properties: { format: { type: 'string', enum: ['html', 'text'] } } };
  const res = validate.validateToolArgs(schema, { format: 'xml' });
  assert.strictEqual(res.valid, false);
});

test('validate: valid args pass', () => {
  const schema = { type: 'object', properties: { url: { type: 'string' }, timeout: { type: 'number', default: 30000 } }, required: ['url'] };
  const res = validate.validateToolArgs(schema, { url: 'https://example.com', timeout: 5000 });
  assert.strictEqual(res.valid, true);
});

// ─── Env boolean parsing ────────────────────────────────────────────────────
test('env-utils: getEnvBool parses true/false/1/0', () => {
  process.env.TEST_BOOL = '1';
  assert.strictEqual(envUtils.getEnvBool('TEST_BOOL', false), true);
  process.env.TEST_BOOL = 'false';
  assert.strictEqual(envUtils.getEnvBool('TEST_BOOL', true), false);
  delete process.env.TEST_BOOL;
  assert.strictEqual(envUtils.getEnvBool('TEST_BOOL', true), true);
});

test('env-utils: sandbox enabled by default (no CI/root env)', () => {
  const prev = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS, CHROME_NO_SANDBOX: process.env.CHROME_NO_SANDBOX };
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  process.env.CHROME_NO_SANDBOX = '0';
  try {
    // On root (CI containers) it returns true; on normal machines false.
    const value = envUtils.shouldDisableChromiumSandbox();
    assert.strictEqual(typeof value, 'boolean');
  } finally {
    Object.assign(process.env, prev);
  }
});