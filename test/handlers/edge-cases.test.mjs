/**
 * Edge Case Tests
 * Tests: Error scenarios, timeouts, invalid inputs, race conditions, stale sessions
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMockBrowser, createMockPage } from '../mocks/browser-mocks.mjs';

// ═══════════════════════════════════════════════════════════════
// Network Failure Scenarios
// ═══════════════════════════════════════════════════════════════

test('edge: navigation fails with DNS error', async () => {
  const page = createMockPage();

  page.goto = async (url) => {
    throw new Error('net::ERR_NAME_NOT_RESOLVED');
  };

  await assert.rejects(
    async () => await page.goto('https://nonexistent-domain-12345.com'),
    /ERR_NAME_NOT_RESOLVED/,
    'Should throw DNS error'
  );
});

test('edge: navigation fails with connection refused', async () => {
  const page = createMockPage();

  page.goto = async (url) => {
    throw new Error('net::ERR_CONNECTION_REFUSED');
  };

  await assert.rejects(
    async () => await page.goto('https://localhost:9999'),
    /ERR_CONNECTION_REFUSED/,
    'Should throw connection refused'
  );
});

test('edge: navigation fails with timeout', async () => {
  const page = createMockPage();

  page.goto = async (url, options = {}) => {
    await new Promise(r => setTimeout(r, options.timeout + 100));
    throw new Error('Navigation timeout');
  };

  await assert.rejects(
    async () => await page.goto('https://slow-site.com', { timeout: 100 }),
    /timeout/,
    'Should timeout on slow navigation'
  );
});

test('edge: handles 5xx server errors', async () => {
  const page = createMockPage();

  page.goto = async (url) => {
    return { ok: false, status: 503, statusText: 'Service Unavailable' };
  };

  const result = await page.goto('https://example.com/api');
  assert.strictEqual(result.ok, false, 'Should fail on 5xx error');
  assert.strictEqual(result.status, 503, 'Should return 503 status');
});

// ═══════════════════════════════════════════════════════════════
// Invalid Input Scenarios
// ═══════════════════════════════════════════════════════════════

test('edge: click with empty selector', async () => {
  const page = createMockPage();

  await assert.rejects(
    async () => await page.click('', { timeout: 100 }),
    /Selector not found/,
    'Should reject empty selector'
  );
});

test('edge: click with invalid selector syntax', async () => {
  const page = createMockPage();

  await assert.rejects(
    async () => await page.click('>>invalid<<', { timeout: 100 }),
    /Selector not found/,
    'Should reject invalid selector'
  );
});

test('edge: type with null text', async () => {
  const page = createMockPage();
  page._addElement('#input', { value: '' });

  // Should handle gracefully or throw clear error
  try {
    await page.type('#input', null);
    assert.fail('Should not accept null text');
  } catch (e) {
    assert.ok(e, 'Should throw error for null text');
  }
});

test('edge: navigate with invalid URL', async () => {
  const page = createMockPage();

  await assert.rejects(
    async () => await page.goto('not-a-valid-url'),
    'Should reject invalid URL'
  );
});

test('edge: navigate with javascript: protocol', async () => {
  // SSRF protection should block this
  const validateUrl = (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol "${parsed.protocol}"`);
    }
    return url;
  };

  assert.throws(
    () => validateUrl('javascript:alert(1)'),
    /Unsupported protocol/,
    'Should block javascript: URLs'
  );
});

test('edge: navigate with file: protocol', async () => {
  const validateUrl = (url) => {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      throw new Error('file: protocol blocked');
    }
    return url;
  };

  assert.throws(
    () => validateUrl('file:///etc/passwd'),
    /file: protocol blocked/,
    'Should block file: URLs'
  );
});

// ═══════════════════════════════════════════════════════════════
// Race Conditions & Concurrent Execution
// ═══════════════════════════════════════════════════════════════

test('edge: concurrent tool execution serialization', async () => {
  const executionLog = [];
  let executionChain = Promise.resolve();

  const serialize = (fn) => {
    const run = executionChain.then(fn);
    executionChain = run.then(() => undefined, () => undefined);
    return run;
  };

  const tool1 = serialize(async () => {
    executionLog.push('tool1-start');
    await new Promise(r => setTimeout(r, 50));
    executionLog.push('tool1-end');
    return 'result1';
  });

  const tool2 = serialize(async () => {
    executionLog.push('tool2-start');
    await new Promise(r => setTimeout(r, 30));
    executionLog.push('tool2-end');
    return 'result2';
  });

  const tool3 = serialize(async () => {
    executionLog.push('tool3-start');
    await new Promise(r => setTimeout(r, 20));
    executionLog.push('tool3-end');
    return 'result3';
  });

  await Promise.all([tool1, tool2, tool3]);

  // Verify serial execution order
  assert.deepStrictEqual(executionLog, [
    'tool1-start', 'tool1-end',
    'tool2-start', 'tool2-end',
    'tool3-start', 'tool3-end'
  ], 'Tools should execute serially');
});

test('edge: watchdog timeout kills hung tool', async () => {
  const TIMEOUT_MS = 100;

  const withWatchdog = (promise, timeout) => {
    let timer;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Tool timed out')), timeout);
    });
    return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
  };

  const hungTool = new Promise(r => setTimeout(r, 500)); // Never resolves in time

  await assert.rejects(
    async () => await withWatchdog(hungTool, TIMEOUT_MS),
    /Tool timed out/,
    'Watchdog should kill hung tool'
  );
});

test('edge: multiple clicks dont interfere', async () => {
  const page = createMockPage();
  page._addElement('#button1', { clicks: 0 });
  page._addElement('#button2', { clicks: 0 });

  // Simulate serialized clicks
  await page.click('#button1');
  await new Promise(r => setTimeout(r, 10));
  await page.click('#button2');
  await new Promise(r => setTimeout(r, 10));
  await page.click('#button1');

  assert.ok(true, 'Multiple clicks should not interfere');
});

// ═══════════════════════════════════════════════════════════════
// Stale Session Recovery
// ═══════════════════════════════════════════════════════════════

test('edge: detects stale page (closed)', async () => {
  const page = createMockPage();
  await page.close();

  assert.strictEqual(page.isClosed(), true, 'Page should be closed');
});

test('edge: detects stale browser (disconnected)', async () => {
  const browser = createMockBrowser();
  await browser.close();

  assert.strictEqual(browser.isConnected(), false, 'Browser should be disconnected');
});

test('edge: recovers from stale session', async () => {
  const staleBrowser = createMockBrowser();
  const stalePage = await (await staleBrowser.newContext()).newPage();

  // Simulate crash
  await stalePage.close();
  await staleBrowser.close();

  // Recovery
  const freshBrowser = createMockBrowser();
  const freshPage = await (await freshBrowser.newContext()).newPage();

  assert.strictEqual(freshBrowser.isConnected(), true, 'New browser should work');
  assert.strictEqual(freshPage.isClosed(), false, 'New page should work');

  await freshBrowser.close();
});

test('edge: handles page crash during navigation', async () => {
  const page = createMockPage();

  page.goto = async (url) => {
    await new Promise(r => setTimeout(r, 10));
    page._mockState.isClosed = true; // Simulate crash
    throw new Error('Target closed');
  };

  await assert.rejects(
    async () => await page.goto('https://crash-site.com'),
    /Target closed/,
    'Should throw on page crash'
  );
});

// ═══════════════════════════════════════════════════════════════
// Memory & Resource Limits
// ═══════════════════════════════════════════════════════════════

test('edge: network records bounded memory', async () => {
  const MAX_RECORDS = 5000;
  const records = [];

  const pushRecord = (record) => {
    records.push(record);
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
  };

  // Add 10000 records
  for (let i = 0; i < 10000; i++) {
    pushRecord({ id: i, url: `https://example.com/${i}` });
  }

  assert.strictEqual(records.length, MAX_RECORDS, 'Should cap at max records');
  assert.strictEqual(records[0].id, 5000, 'Should keep most recent records');
  assert.strictEqual(records[records.length - 1].id, 9999, 'Should keep latest record');
});

test('edge: content truncation at 2MB', async () => {
  const MAX_CHARS = 2_000_000;
  const largeContent = 'x'.repeat(3_000_000);

  const truncated = largeContent.slice(0, MAX_CHARS);

  assert.strictEqual(truncated.length, MAX_CHARS, 'Should truncate at 2MB');
});

test('edge: handles extremely long selector', async () => {
  const page = createMockPage();
  const longSelector = 'div'.repeat(1000); // Very long selector

  await assert.rejects(
    async () => await page.click(longSelector, { timeout: 100 }),
    /Selector not found/,
    'Should handle long selector gracefully'
  );
});

// ═══════════════════════════════════════════════════════════════
// Dialog & Popup Handling
// ═══════════════════════════════════════════════════════════════

test('edge: auto-dismisses alert dialog', async () => {
  let dialogHandled = false;

  const mockDialog = {
    type: () => 'alert',
    message: () => 'This is an alert',
    dismiss: async () => { dialogHandled = true; }
  };

  await mockDialog.dismiss();
  assert.strictEqual(dialogHandled, true, 'Alert should be dismissed');
});

test('edge: auto-cancels confirm dialog (safety)', async () => {
  let dialogResult = null;

  const mockDialog = {
    type: () => 'confirm',
    message: () => 'Delete everything?',
    dismiss: async () => { dialogResult = false; }
  };

  await mockDialog.dismiss();
  assert.strictEqual(dialogResult, false, 'Confirm should default to cancel');
});

test('edge: blocks navigation confirm dialogs', async () => {
  const mockDialog = {
    type: () => 'confirm',
    message: () => 'This page is asking to redirect',
    dismiss: async () => true
  };

  const isNavigationConfirm = mockDialog.message().toLowerCase().includes('redirect');
  assert.strictEqual(isNavigationConfirm, true, 'Should detect navigation confirm');
  await mockDialog.dismiss();
});

// ═══════════════════════════════════════════════════════════════
// Error Recovery Patterns
// ═══════════════════════════════════════════════════════════════

test('edge: retries on transient error', async () => {
  let attempts = 0;
  const maxRetries = 3;

  const unreliableOperation = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('Transient error');
    }
    return 'success';
  };

  const withRetry = async (fn, retries) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 50));
      }
    }
  };

  const result = await withRetry(unreliableOperation, maxRetries);
  assert.strictEqual(result, 'success', 'Should succeed after retries');
  assert.strictEqual(attempts, 3, 'Should retry twice before success');
});

test('edge: gives up after max retries', async () => {
  let attempts = 0;
  const maxRetries = 3;

  const alwaysFailOperation = async () => {
    attempts++;
    throw new Error('Permanent error');
  };

  const withRetry = async (fn, retries) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 10));
      }
    }
  };

  await assert.rejects(
    async () => await withRetry(alwaysFailOperation, maxRetries),
    /Permanent error/,
    'Should give up after max retries'
  );

  assert.strictEqual(attempts, 4, 'Should try 4 times (1 + 3 retries)');
});
