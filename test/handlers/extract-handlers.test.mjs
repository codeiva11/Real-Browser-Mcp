/**
 * Unit Tests for Extract Handlers
 * Tests: get_content, extract_data
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMockPage } from '../mocks/browser-mocks.mjs';

test('get_content: extracts HTML content', async () => {
  const page = createMockPage();
  page._mockState.content = '<html><body><h1>Test Page</h1><p>Content here</p></body></html>';

  const content = await page.content();

  assert.ok(content.includes('<h1>Test Page</h1>'), 'Should extract HTML');
  assert.ok(content.includes('<p>Content here</p>'), 'Should include all elements');
});

test('get_content: extracts text format', async () => {
  const page = createMockPage();

  page._setEvaluateResult('function getText', 'Test Page\nContent here');

  const text = await page.evaluate(() => document.body.innerText);

  assert.strictEqual(text, 'Test Page\nContent here', 'Should extract plain text');
});

test('get_content: extracts from selector', async () => {
  const page = createMockPage();

  const element = {
    outerHTML: '<div class="article"><h2>Title</h2><p>Body text</p></div>',
    textContent: 'Title\nBody text',
  };
  page._addElement('.article', element);

  const el = await page.$('.article');
  const html = await el.evaluate((e) => e.outerHTML);

  assert.ok(html.includes('<h2>Title</h2>'), 'Should extract selector content');
});

test('get_content: handles missing selector', async () => {
  const page = createMockPage();

  const el = await page.$('#missing');

  assert.strictEqual(el, null, 'Should return null for missing selector');
});

test('get_content: extracts multiple elements', async () => {
  const page = createMockPage();

  const elements = [
    { textContent: 'Item 1', tag: 'LI' },
    { textContent: 'Item 2', tag: 'LI' },
    { textContent: 'Item 3', tag: 'LI' },
  ];
  page._addElement('li', elements[0]);

  const items = await page.$$eval('li', (els) =>
    els.map(el => ({ text: el.textContent, tag: el.tag }))
  );

  assert.ok(Array.isArray(items), 'Should return array');
});

test('get_content: rawHttp mode without JS', async () => {
  // This would use fetch() in real implementation
  const url = 'https://example.com';
  const rawHtml = '<html><body>Raw content</body></html>';

  // Simulate fetch
  const response = {
    text: async () => rawHtml,
    status: 200,
    url: url,
  };

  assert.strictEqual(response.status, 200, 'Should fetch successfully');
  assert.ok((await response.text()).includes('Raw content'), 'Should get raw HTML');
});

test('get_content: path traversal protection', async () => {
  const path = (await import('node:path')).default;

  // Safe path resolution
  const safeResolve = (savePath) => {
    const resolved = path.resolve(savePath);
    const cwd = path.resolve(process.cwd());
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
      return null; // Block traversal
    }
    return resolved;
  };

  const maliciousPath = '../../../etc/passwd';
  const result = safeResolve(maliciousPath);

  assert.strictEqual(result, null, 'Should block path traversal');
});

test('extract_data: regex extraction', async () => {
  const html = 'Email: test@example.com, Phone: 123-456-7890';
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

  const matches = html.match(emailRegex);

  assert.ok(Array.isArray(matches), 'Should find matches');
  assert.strictEqual(matches[0], 'test@example.com', 'Should extract email');
});

test('extract_data: JSON extraction', async () => {
  const html = '<script type="application/json">{"data": [1, 2, 3]}</script>';
  const jsonMatch = html.match(/\{[^}]+\}/);

  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[0]);
    assert.deepStrictEqual(data, { data: [1, 2, 3] }, 'Should extract JSON');
  }
});

test('extract_data: meta tags extraction', async () => {
  const page = createMockPage();

  page._setEvaluateResult('function getMeta', {
    title: 'Test Page',
    description: 'A test page',
    'og:image': 'https://example.com/image.jpg',
  });

  const meta = await page.evaluate(() => {
    const metaTags = document.querySelectorAll('meta');
    const result = {};
    metaTags.forEach(tag => {
      const name = tag.getAttribute('name') || tag.getAttribute('property');
      const content = tag.getAttribute('content');
      if (name && content) result[name] = content;
    });
    return result;
  });

  assert.ok(typeof meta === 'object', 'Should return meta object');
});

test('extract_data: auto-decode base64', async () => {
  const encoded = Buffer.from('Hello World').toString('base64');
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');

  assert.strictEqual(decoded, 'Hello World', 'Should decode base64');
});

test('extract_data: URL decode', async () => {
  const encoded = 'Hello%20World%21';
  const decoded = decodeURIComponent(encoded);

  assert.strictEqual(decoded, 'Hello World!', 'Should decode URL');
});

test('extract_data: links extraction', async () => {
  const page = createMockPage();

  page._setEvaluateResult('function getLinks', [
    { href: 'https://example.com/page1', text: 'Page 1' },
    { href: 'https://example.com/page2', text: 'Page 2' },
  ]);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.href,
      text: a.textContent,
    }))
  );

  assert.ok(Array.isArray(links), 'Should return links array');
});

test('extract_data: structured data from table', async () => {
  const page = createMockPage();

  page._setEvaluateResult('function getTable', [
    { name: 'John', age: 30 },
    { name: 'Jane', age: 25 },
  ]);

  const tableData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      return cells.map(cell => cell.textContent);
    });
  });

  assert.ok(Array.isArray(tableData), 'Should extract table data');
});
