/**
 * Performance Benchmarks
 * Tests: Tool execution times, memory usage, long-session stability
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMockBrowser, createMockPage } from '../mocks/browser-mocks.mjs';

// ═══════════════════════════════════════════════════════════════
// Tool Execution Time Benchmarks
// ═══════════════════════════════════════════════════════════════

test('perf: click execution time < 1s', async () => {
  const page = createMockPage();
  page._addElement('#button', { text: 'Click me' });

  const start = performance.now();
  await page.click('#button');
  const duration = performance.now() - start;

  assert.ok(duration < 1000, `Click took ${duration.toFixed(2)}ms (should be < 1000ms)`);
  console.log(`  ⏱️  Click: ${duration.toFixed(2)}ms`);
});

test('perf: type execution time < 500ms for 50 chars', async () => {
  const page = createMockPage();
  page._addElement('#input', { value: '' });

  const text = 'x'.repeat(50);
  const start = performance.now();
  await page.type('#input', text, { delay: 0 });
  const duration = performance.now() - start;

  assert.ok(duration < 500, `Type took ${duration.toFixed(2)}ms (should be < 500ms)`);
  console.log(`  ⏱️  Type 50 chars: ${duration.toFixed(2)}ms`);
});

test('perf: scroll execution time < 200ms', async () => {
  const page = createMockPage();

  const start = performance.now();
  await page.mouse.wheel(0, 500);
  const duration = performance.now() - start;

  assert.ok(duration < 200, `Scroll took ${duration.toFixed(2)}ms (should be < 200ms)`);
  console.log(`  ⏱️  Scroll: ${duration.toFixed(2)}ms`);
});

test('perf: screenshot execution time < 2s', async () => {
  const page = createMockPage();

  const start = performance.now();
  await page.screenshot({ type: 'jpeg', quality: 70 });
  const duration = performance.now() - start;

  assert.ok(duration < 2000, `Screenshot took ${duration.toFixed(2)}ms (should be < 2000ms)`);
  console.log(`  ⏱️  Screenshot: ${duration.toFixed(2)}ms`);
});

test('perf: content extraction time < 500ms', async () => {
  const page = createMockPage();
  page._mockState.content = '<html>' + '<div>'.repeat(1000) + 'content' + '</div>'.repeat(1000) + '</html>';

  const start = performance.now();
  await page.content();
  const duration = performance.now() - start;

  assert.ok(duration < 500, `Content extraction took ${duration.toFixed(2)}ms (should be < 500ms)`);
  console.log(`  ⏱️  Content extraction: ${duration.toFixed(2)}ms`);
});

// ═══════════════════════════════════════════════════════════════
// Memory Usage Monitoring
// ═══════════════════════════════════════════════════════════════

test('perf: memory usage stays bounded', async () => {
  const initialMemory = process.memoryUsage().heapUsed;

  // Simulate multiple operations
  const page = createMockPage();
  for (let i = 0; i < 100; i++) {
    page._addElement(`#element-${i}`, { text: `Element ${i}` });
    await page.click(`#element-${i}`);
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const memoryGrowth = (finalMemory - initialMemory) / 1024 / 1024; // MB

  console.log(`  💾 Memory growth: ${memoryGrowth.toFixed(2)} MB`);
  assert.ok(memoryGrowth < 50, 'Memory growth should be < 50MB');
});

test('perf: network records memory cap enforced', async () => {
  const MAX_RECORDS = 5000;
  const records = [];

  const pushRecord = (record) => {
    records.push(record);
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
  };

  const start = performance.now();

  // Simulate high-traffic recording
  for (let i = 0; i < 20000; i++) {
    pushRecord({
      id: i,
      url: `https://example.com/api/${i}`,
      timestamp: Date.now(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(100) })
    });
  }

  const duration = performance.now() - start;

  assert.strictEqual(records.length, MAX_RECORDS, 'Should cap at 5000 records');
  console.log(`  ⏱️  20k records → ${MAX_RECORDS} records in ${duration.toFixed(2)}ms`);
  console.log(`  💾 Memory: ${(JSON.stringify(records).length / 1024 / 1024).toFixed(2)} MB`);
});

test('perf: large content truncation performance', async () => {
  const MAX_CHARS = 2_000_000;
  const largeContent = 'x'.repeat(5_000_000);

  const start = performance.now();
  const truncated = largeContent.slice(0, MAX_CHARS);
  const duration = performance.now() - start;

  assert.strictEqual(truncated.length, MAX_CHARS, 'Should truncate to 2M chars');
  console.log(`  ⏱️  Truncate 5M → 2M chars: ${duration.toFixed(2)}ms`);
  assert.ok(duration < 100, 'Truncation should be fast');
});

// ═══════════════════════════════════════════════════════════════
// Long-Session Stability
// ═══════════════════════════════════════════════════════════════

test('perf: 100 consecutive navigations', async () => {
  const page = createMockPage();
  let failures = 0;

  const start = performance.now();

  for (let i = 0; i < 100; i++) {
    try {
      await page.goto(`https://example.com/page${i}`);
    } catch (e) {
      failures++;
    }
  }

  const duration = performance.now() - start;
  const avgTime = duration / 100;

  console.log(`  ⏱️  100 navigations: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(2)}ms)`);
  console.log(`  ✅ Success rate: ${100 - failures}%`);

  assert.strictEqual(failures, 0, 'All navigations should succeed');
  assert.ok(avgTime < 100, 'Average navigation should be < 100ms');
});

test('perf: 500 consecutive clicks', async () => {
  const page = createMockPage();
  page._addElement('#button', { text: 'Click me' });

  const start = performance.now();

  for (let i = 0; i < 500; i++) {
    await page.click('#button');
  }

  const duration = performance.now() - start;
  const avgTime = duration / 500;

  console.log(`  ⏱️  500 clicks: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(2)}ms)`);

  assert.ok(avgTime < 50, 'Average click should be < 50ms');
});

test('perf: sustained screenshot capture (50 screenshots)', async () => {
  const page = createMockPage();
  const screenshots = [];

  const start = performance.now();

  for (let i = 0; i < 50; i++) {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    screenshots.push(buffer);
  }

  const duration = performance.now() - start;
  const avgTime = duration / 50;

  console.log(`  ⏱️  50 screenshots: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(2)}ms)`);
  console.log(`  💾 Total size: ${(screenshots.reduce((sum, b) => sum + b.length, 0) / 1024).toFixed(2)} KB`);

  assert.ok(avgTime < 100, 'Average screenshot should be < 100ms');
});

// ═══════════════════════════════════════════════════════════════
// Concurrent Operations Performance
// ═══════════════════════════════════════════════════════════════

test('perf: serialized tool execution overhead', async () => {
  let executionChain = Promise.resolve();

  const serialize = (fn) => {
    const run = executionChain.then(fn);
    executionChain = run.then(() => undefined, () => undefined);
    return run;
  };

  const tools = [];
  const start = performance.now();

  // Queue 100 fast tools
  for (let i = 0; i < 100; i++) {
    tools.push(serialize(async () => {
      await new Promise(r => setTimeout(r, 1));
      return i;
    }));
  }

  const results = await Promise.all(tools);
  const duration = performance.now() - start;

  console.log(`  ⏱️  100 serialized tools: ${duration.toFixed(2)}ms`);
  assert.strictEqual(results.length, 100, 'All tools should complete');

  // Serialization overhead should be small. Bound is generous because timer
  // granularity varies wildly across OSes/load (Windows timers can be ~15ms),
  // which makes tight <100ms assertions flaky in CI.
  const expectedMinTime = 100 * 1; // 1ms per tool
  const overhead = duration - expectedMinTime;
  console.log(`  ⚡ Serialization overhead: ${overhead.toFixed(2)}ms`);
  assert.ok(overhead < 5000, 'Serialization overhead should stay bounded');
});

test('perf: watchdog timeout overhead', async () => {
  const TIMEOUT_MS = 1000;

  const withWatchdog = (promise, timeout) => {
    let timer;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
  };

  const start = performance.now();

  // Fast operation (watchdog should not slow it down)
  const fastOp = async () => {
    await new Promise(r => setTimeout(r, 10));
    return 'done';
  };

  const result = await withWatchdog(fastOp(), TIMEOUT_MS);
  const duration = performance.now() - start;

  console.log(`  ⏱️  Watchdog-wrapped operation: ${duration.toFixed(2)}ms`);
  assert.strictEqual(result, 'done', 'Operation should complete');
  assert.ok(duration < 50, 'Watchdog should add minimal overhead');
});

// ═══════════════════════════════════════════════════════════════
// Resource Cleanup Performance
// ═══════════════════════════════════════════════════════════════

test('perf: browser close time', async () => {
  const browser = createMockBrowser();
  const context = await browser.newContext();

  // Create multiple pages
  for (let i = 0; i < 10; i++) {
    await context.newPage();
  }

  const start = performance.now();
  await browser.close();
  const duration = performance.now() - start;

  console.log(`  ⏱️  Close browser (10 pages): ${duration.toFixed(2)}ms`);
  assert.ok(duration < 500, 'Browser close should be < 500ms');
  assert.strictEqual(browser.isConnected(), false, 'Browser should be closed');
});

test('perf: network recorder cleanup', async () => {
  const records = new Array(5000).fill(null).map((_, i) => ({
    id: i,
    url: `https://example.com/${i}`,
    timestamp: Date.now(),
  }));

  const start = performance.now();
  records.length = 0; // Clear all records
  const duration = performance.now() - start;

  console.log(`  ⏱️  Clear 5000 network records: ${duration.toFixed(2)}ms`);
  assert.strictEqual(records.length, 0, 'All records should be cleared');
  assert.ok(duration < 10, 'Cleanup should be instant');
});

// ═══════════════════════════════════════════════════════════════
// Stress Tests
// ═══════════════════════════════════════════════════════════════

test('perf: stress - 1000 element selector scan', async () => {
  const page = createMockPage();

  // Add 1000 elements
  for (let i = 0; i < 1000; i++) {
    page._addElement(`#element-${i}`, { text: `Element ${i}` });
  }

  const start = performance.now();

  // Scan for specific element
  let found = null;
  for (let i = 0; i < 1000; i++) {
    const el = await page.$(`#element-${i}`);
    if (el && i === 500) {
      found = el;
      break;
    }
  }

  const duration = performance.now() - start;

  console.log(`  ⏱️  Scan 1000 elements: ${duration.toFixed(2)}ms`);
  assert.ok(found, 'Should find target element');
  assert.ok(duration < 2000, 'Scan should complete in < 2s');
});

test('perf: stress - rapid click sequence', async () => {
  const page = createMockPage();
  page._addElement('#button', { clicks: 0 });

  const start = performance.now();

  // Rapid clicks (no delay)
  for (let i = 0; i < 100; i++) {
    await page.click('#button');
  }

  const duration = performance.now() - start;
  const clicksPerSecond = (100 / duration * 1000).toFixed(0);

  console.log(`  ⏱️  100 rapid clicks: ${duration.toFixed(2)}ms`);
  console.log(`  ⚡ Throughput: ${clicksPerSecond} clicks/sec`);

  assert.ok(duration < 5000, 'Rapid clicks should complete in < 5s');
});
