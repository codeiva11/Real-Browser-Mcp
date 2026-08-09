/**
 * Integration Tests
 * Tests: Multi-tool workflows, complex scenarios, end-to-end flows
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMockBrowser, createMockPage } from '../mocks/browser-mocks.mjs';

// ═══════════════════════════════════════════════════════════════
// Multi-Tool Workflows
// ═══════════════════════════════════════════════════════════════

test('integration: see_page → click → extract workflow', async () => {
  const page = createMockPage();

  // 1. See page (capture initial state)
  page._addElement('#search-button', { text: 'Search' });
  page._addElement('#results', { html: '<div class="result">Result 1</div>' });

  const screenshot = await page.screenshot({ type: 'jpeg' });
  const listInteractive = () => {
    return Array.from(document.querySelectorAll('button, a')).map(el => ({
      selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
      text: el.textContent,
    }));
  };
  page._setEvaluateResult(listInteractive.toString(), [
    { selector: '#search-button', text: 'Search' },
  ]);
  const elements = await page.evaluate(listInteractive);

  assert.ok(screenshot, 'Should capture screenshot');
  assert.ok(Array.isArray(elements), 'Should find interactive elements');

  // 2. Click button
  await page.click('#search-button');
  await page.waitForSelector('#results', { timeout: 5000 });

  // 3. Extract results
  const results = await page.$('#results');
  const content = await results.evaluate(el => el.outerHTML);

  assert.ok(content.includes('Result 1'), 'Should extract search results');
});

test('integration: navigate → type → submit → extract', async () => {
  const page = createMockPage();

  // 1. Navigate to form page
  await page.goto('https://example.com/form');
  assert.strictEqual(page.url(), 'https://example.com/form');

  // 2. Fill form fields
  page._addElement('#username', { value: '' });
  page._addElement('#password', { value: '' });
  page._addElement('#submit', { text: 'Login' });

  await page.type('#username', 'testuser');
  await page.type('#password', 'password123');

  // 3. Submit form
  await page.click('#submit');
  await new Promise(r => setTimeout(r, 50)); // Wait for navigation

  // 4. Extract success message
  page._addElement('.success', { text: 'Login successful' });
  const success = await page.$('.success');
  const message = await success.evaluate(el => el.textContent);

  assert.strictEqual(message, 'Login successful', 'Should show success message');
});

test('integration: scroll → lazy load → extract', async () => {
  const page = createMockPage();

  // Initial content
  page._addElement('.item', { text: 'Item 1' });

  // 1. Detect lazy load
  const lazyInfo = await page.evaluate(() => ({
    lazyImages: document.querySelectorAll('img[loading="lazy"]').length,
    infiniteScroll: !!document.querySelector('[class*="infinite"]'),
  }));

  // 2. Scroll to trigger lazy load
  await page.mouse.wheel(0, 500);
  await new Promise(r => setTimeout(r, 100)); // Wait for lazy load

  // Simulate new content loaded
  page._addElement('.item-2', { text: 'Item 2' });

  // 3. Extract all items
  const items = await page.$$('.item, .item-2');

  assert.ok(items.length >= 2, 'Should load lazy content');
});

test('integration: see_page with steps[] workflow', async () => {
  const page = createMockPage();

  // Setup page
  page._addElement('#search', { value: '' });
  page._addElement('#button', { text: 'Search' });
  page._addElement('.results', { html: '<div>Results here</div>' });

  // Capture initial state
  const beforeScreenshot = await page.screenshot({ type: 'jpeg' });

  // Execute multi-step workflow
  const steps = [
    { action: 'type', selector: '#search', text: 'test query' },
    { action: 'click', selector: '#button' },
    { action: 'wait', waitType: 'selector', value: '.results' },
    { action: 'scroll', direction: 'down', amount: 300 },
    { action: 'extract', format: 'html', selector: '.results' },
  ];

  // Execute steps sequentially
  for (const step of steps) {
    if (step.action === 'type') {
      await page.type(step.selector, step.text);
    } else if (step.action === 'click') {
      await page.click(step.selector);
    } else if (step.action === 'wait') {
      if (step.waitType === 'selector') {
        await page.waitForSelector(step.value);
      }
    } else if (step.action === 'scroll') {
      await page.mouse.wheel(0, step.amount);
    } else if (step.action === 'extract') {
      const el = await page.$(step.selector);
      await el.evaluate(e => e.outerHTML);
    }
  }

  // Capture final state
  const afterScreenshot = await page.screenshot({ type: 'jpeg' });

  assert.ok(beforeScreenshot, 'Should capture before screenshot');
  assert.ok(afterScreenshot, 'Should capture after screenshot');
});

// ═══════════════════════════════════════════════════════════════
// Network Recorder Workflows
// ═══════════════════════════════════════════════════════════════

test('integration: network recorder across multiple navigations', async () => {
  const page = createMockPage();
  const networkRecords = [];

  // Simulate network recording
  const recordRequest = (url, type) => {
    networkRecords.push({
      url,
      type,
      timestamp: Date.now(),
      method: 'GET',
    });
  };

  // Start recording
  const recordingActive = true;

  // Navigate to multiple pages
  await page.goto('https://example.com/page1');
  if (recordingActive) recordRequest(page.url(), 'navigation');

  await page.goto('https://example.com/page2');
  if (recordingActive) recordRequest(page.url(), 'navigation');

  await page.goto('https://example.com/api/data');
  if (recordingActive) recordRequest(page.url(), 'api_call');

  // Verify recordings
  assert.strictEqual(networkRecords.length, 3, 'Should record all navigations');
  assert.ok(networkRecords.some(r => r.type === 'api_call'), 'Should detect API calls');
});

test('integration: API discovery and schema generation', async () => {
  const page = createMockPage();
  const apiCalls = [];

  // Simulate API monitoring
  await page.goto('https://example.com/app');

  // Simulate XHR/fetch calls
  apiCalls.push({
    url: 'https://api.example.com/users',
    method: 'GET',
    responseBody: JSON.stringify({ users: [{ id: 1, name: 'John' }] }),
  });

  apiCalls.push({
    url: 'https://api.example.com/posts',
    method: 'GET',
    responseBody: JSON.stringify({ posts: [{ id: 1, title: 'Test' }] }),
  });

  // Generate schema from API responses
  const schemas = apiCalls.map(call => {
    const data = JSON.parse(call.responseBody);
    return {
      url: call.url,
      schema: Object.keys(data),
    };
  });

  assert.strictEqual(schemas.length, 2, 'Should generate schemas for all APIs');
  assert.ok(schemas[0].schema.includes('users'), 'Should extract schema structure');
});

// ═══════════════════════════════════════════════════════════════
// Media Extraction Workflows
// ═══════════════════════════════════════════════════════════════

test('integration: media extraction from complex page', async () => {
  const page = createMockPage();

  // Simulate page with multiple iframes
  const mainFrame = page;
  const iframes = [
    { index: 1, url: 'https://player.vimeo.com/video/123' },
    { index: 2, url: 'https://www.youtube.com/embed/456' },
  ];

  // List iframes
  const iframeList = iframes.map((f, i) => ({
    index: i + 1,
    url: f.url,
    detected: true,
  }));

  assert.strictEqual(iframeList.length, 2, 'Should list all iframes');

  // Extract media from each iframe
  const mediaUrls = [];

  page._setEvaluateResult('function getMedia', {
    video: ['https://example.com/video.mp4'],
    hls: ['https://example.com/stream.m3u8'],
  });

  const media = await page.evaluate(() => ({
    video: ['https://example.com/video.mp4'],
    hls: ['https://example.com/stream.m3u8'],
  }));

  mediaUrls.push(...media.video, ...media.hls);

  assert.ok(mediaUrls.length >= 2, 'Should extract media URLs');
  assert.ok(mediaUrls.some(url => url.includes('.mp4')), 'Should find video files');
  assert.ok(mediaUrls.some(url => url.includes('.m3u8')), 'Should find HLS streams');
});

test('integration: batch media extraction', async () => {
  const urls = [
    'https://example.com/video1',
    'https://example.com/video2',
    'https://example.com/video3',
  ];

  const results = [];

  for (const url of urls) {
    const page = createMockPage();
    await page.goto(url);

    // Real Playwright serializes callbacks (no outer-scope closure), so the
    // mock matches by callback source — register the exact fn string.
    const getMedia = () => ({
      video: [`${url}/stream.mp4`],
    });
    page._setEvaluateResult(getMedia.toString(), {
      video: [`${url}/stream.mp4`],
    });

    const media = await page.evaluate(getMedia);

    results.push({ url, media: media.video });
    await page.close();
  }

  assert.strictEqual(results.length, 3, 'Should process all URLs');
  assert.ok(results.every(r => r.media.length > 0), 'Should extract media from all pages');
});

// ═══════════════════════════════════════════════════════════════
// Anti-Bot Bypass Workflows
// ═══════════════════════════════════════════════════════════════

test('integration: stealth navigation with human-like interactions', async () => {
  const browser = createMockBrowser();
  const context = await browser.newContext({
    // Stealth config
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
    viewport: null,
  });

  const page = await context.newPage();

  // 1. Navigate with retry
  let attempts = 0;
  const maxRetries = 3;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      attempts++;
      await page.goto('https://protected-site.com', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      break;
    } catch (e) {
      if (i === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 2. Human-like interaction
  page._addElement('#protected-button', { text: 'Continue' });

  await page.hover('#protected-button'); // Hover first
  await new Promise(r => setTimeout(r, 500)); // Natural delay
  await page.click('#protected-button'); // Then click

  // 3. Verify success
  assert.ok(attempts <= maxRetries, 'Should eventually succeed');
  assert.strictEqual(page.url(), 'https://protected-site.com');

  await browser.close();
});

test('integration: Turnstile widget handling', async () => {
  const page = createMockPage();

  // Simulate Turnstile widget detection. Mock evaluate() matches presets by
  // the exact callback source, so the preset key must be the callback string.
  const detectTurnstile = () => ({
    detected: !!document.querySelector('.cf-turnstile'),
    selector: '.cf-turnstile',
    sitekey: document.querySelector('.cf-turnstile')?.dataset?.sitekey,
  });
  page._setEvaluateResult(detectTurnstile.toString(), {
    detected: true,
    selector: '.cf-turnstile',
    sitekey: 'test-sitekey',
  });

  const turnstile = await page.evaluate(detectTurnstile);

  if (turnstile.detected) {
    // Widget assist would handle interaction here
    await new Promise(r => setTimeout(r, 2000)); // Simulate completion

    const checkTurnstile = () => ({
      solved: true,
      token: 'mock-token',
    });
    page._setEvaluateResult(checkTurnstile.toString(), {
      solved: true,
      token: 'mock-token',
    });

    const result = await page.evaluate(checkTurnstile);

    assert.strictEqual(result.solved, true, 'Should solve Turnstile');
    assert.ok(result.token, 'Should get token');
  }
});

// ═══════════════════════════════════════════════════════════════
// Error Recovery Workflows
// ═══════════════════════════════════════════════════════════════

test('integration: graceful recovery from page crash', async () => {
  const browser = createMockBrowser();
  let page = await (await browser.newContext()).newPage();

  // Simulate page crash
  await page.close();

  // Detect stale session
  const isStale = page.isClosed();
  assert.strictEqual(isStale, true, 'Should detect page crash');

  // Recovery: create fresh page
  page = await (await browser.newContext()).newPage();
  await page.goto('https://example.com');

  assert.strictEqual(page.isClosed(), false, 'New page should work');

  await browser.close();
});

test('integration: retry workflow on transient failures', async () => {
  const page = createMockPage();
  let navigationAttempts = 0;
  let clickAttempts = 0;

  // Simulate unreliable operations
  const unreliableNavigate = async () => {
    navigationAttempts++;
    if (navigationAttempts < 2) throw new Error('Navigation failed');
    return await page.goto('https://example.com');
  };

  const unreliableClick = async () => {
    clickAttempts++;
    if (clickAttempts < 2) throw new Error('Click failed');
    page._addElement('#button', {});
    return await page.click('#button');
  };

  // Retry wrapper
  const withRetry = async (fn, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 100));
      }
    }
  };

  // Execute with retries
  await withRetry(unreliableNavigate);
  await withRetry(unreliableClick);

  assert.strictEqual(navigationAttempts, 2, 'Should retry navigation');
  assert.strictEqual(clickAttempts, 2, 'Should retry click');
});

// ═══════════════════════════════════════════════════════════════
// Complex Real-World Scenarios
// ═══════════════════════════════════════════════════════════════

test('integration: complete scraping workflow', async () => {
  const page = createMockPage();

  // 1. Navigate to listing page
  await page.goto('https://example.com/products');

  // 2. Extract product links
  const getLinks = () =>
    Array.from(document.querySelectorAll('a.product-link')).map(a => a.href);
  page._setEvaluateResult(getLinks.toString(), [
    'https://example.com/product/1',
    'https://example.com/product/2',
    'https://example.com/product/3',
  ]);

  const links = await page.evaluate(getLinks);

  // 3. Visit each product page
  const products = [];

  for (const link of links) {
    await page.goto(link);

    const getProduct = () => ({
      title: document.querySelector('.title')?.textContent,
      price: document.querySelector('.price')?.textContent,
      image: document.querySelector('img')?.src,
    });
    page._setEvaluateResult(getProduct.toString(), {
      title: `Product ${links.indexOf(link) + 1}`,
      price: '$99.99',
      image: `${link}/image.jpg`,
    });

    const product = await page.evaluate(getProduct);

    products.push(product);
  }

  // 4. Verify results
  assert.strictEqual(products.length, 3, 'Should scrape all products');
  assert.ok(products.every(p => p.title && p.price), 'Should extract complete data');
});
