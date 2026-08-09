/**
 * Mock Browser and Page objects for unit testing
 * Provides realistic mocks without requiring actual browser instances
 */

export function createMockPage() {
  const state = {
    url: 'https://example.com',
    title: 'Example Page',
    content: '<html><body><h1>Test</h1></body></html>',
    isClosed: false,
    elements: new Map(),
    elementRefs: new Map(), // original objects passed to _addElement
    scrollY: 0,
    evaluateResults: new Map(),
  };

  const mockPage = {
    // Navigation
    goto: async (url, options = {}) => {
      if (state.isClosed) throw new Error('Page is closed');
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'about:') {
          throw new Error(`Unsupported protocol "${parsed.protocol}"`);
        }
      } catch (e) {
        if (e instanceof TypeError) throw new Error(`Invalid URL: ${url}`);
        throw e;
      }
      state.url = url;
      await new Promise(r => setTimeout(r, 10)); // Simulate network
      return { ok: true, status: 200 };
    },

    url: () => state.url,
    title: () => Promise.resolve(state.title),
    content: () => Promise.resolve(state.content),
    isClosed: () => state.isClosed,

    // Selectors
    waitForSelector: async (selector, options = {}) => {
      if (state.isClosed) throw new Error('Page is closed');
      const timeout = options.timeout || 30000;
      await new Promise(r => setTimeout(r, 10));
      if (!state.elements.has(selector)) {
        throw new Error(`Selector not found: ${selector}`);
      }
      return state.elements.get(selector);
    },

    $: async (selector) => {
      if (state.isClosed) throw new Error('Page is closed');
      return state.elements.get(selector) || null;
    },

    $$: async (selector) => {
      if (state.isClosed) throw new Error('Page is closed');
      // Support comma-separated selector lists (e.g. '.item, .item-2')
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      const out = [];
      for (const p of parts) {
        const el = state.elements.get(p);
        if (el) out.push(el);
      }
      return out;
    },

    $$eval: async (selector, fn) => {
      if (state.isClosed) throw new Error('Page is closed');
      const elements = await mockPage.$$(selector);
      return fn(elements);
    },

    // Interactions
    click: async (selector, options = {}) => {
      if (state.isClosed) throw new Error('Page is closed');
      await mockPage.waitForSelector(selector, { timeout: 5000 });
      await new Promise(r => setTimeout(r, 10));
      return true;
    },

    hover: async (selector) => {
      if (state.isClosed) throw new Error('Page is closed');
      await mockPage.waitForSelector(selector, { timeout: 5000 });
      await new Promise(r => setTimeout(r, 10));
      return true;
    },

    type: async (selector, text, options = {}) => {
      if (state.isClosed) throw new Error('Page is closed');
      await mockPage.waitForSelector(selector, { timeout: 5000 });
      const element = state.elements.get(selector);
      if (element) {
        element.value = text;
      }
      // Propagate to the original object the caller passed to _addElement so
      // tests can assert on their own reference.
      const ref = state.elementRefs.get(selector);
      if (ref) ref.value = text;
      await new Promise(r => setTimeout(r, text.length * (options.delay || 0)));
      return true;
    },

    // Evaluate
    evaluate: async (fn, ...args) => {
      if (state.isClosed) throw new Error('Page is closed');

      // Check if we have a pre-set result for this function
      const fnString = fn.toString();
      if (state.evaluateResults.has(fnString)) {
        return state.evaluateResults.get(fnString);
      }

      // Default behavior for common evaluations
      if (fnString.includes('scrollY') && fnString.includes('scrollHeight')) {
        return {
          scrollY: state.scrollY,
          scrollHeight: 2000,
          innerHeight: 1000,
        };
      }
      if (fnString.includes('scrollY')) {
        return state.scrollY;
      }
      if (fnString.includes('innerWidth') && fnString.includes('innerHeight')) {
        return { innerWidth: 1920, innerHeight: 1080, scrollY: state.scrollY };
      }
      if (fnString.includes('innerText &&')) {
        return 'Test Page\nContent here';
      }
      if (fnString.includes('body.innerText')) {
        return 'Test Page\nContent here';
      }

      // Run the callback against a minimal empty-DOM sandbox so real handler
      // logic (querySelector scans, scroll info, heal fallbacks) executes like
      // it would on an empty page instead of throwing ReferenceError. This is
      // what lets the handler tests drive the REAL handlers.
      try {
        const sandboxDocument = {
          body: { scrollHeight: 2000, innerText: '' },
          documentElement: { scrollHeight: 2000 },
          title: state.title,
          querySelectorAll: () => [],
          querySelector: () => null,
          getElementById: () => null,
          createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {} }),
          addEventListener: () => {},
        };
        const sandboxWindow = {
          scrollY: state.scrollY,
          innerWidth: 1920,
          innerHeight: 1080,
          scrollBy: () => {},
          scrollTo: () => {},
          location: { href: state.url, protocol: 'https:' },
          getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
          MutationObserver: class { observe() {} disconnect() {} },
          addEventListener: () => {},
        };
        const runner = new Function(
          'document', 'window', 'navigator', 'location', 'CSS', 'MutationObserver',
          `return (${fnString});`
        );
        const impl = runner(
          sandboxDocument, sandboxWindow, { userAgent: 'mock-ua' },
          sandboxWindow.location, { escape: (s) => String(s) }, sandboxWindow.MutationObserver
        );
        if (typeof impl !== 'function') return null;
        return await impl(...args);
      } catch (e) {
        return null;
      }
    },

    // Wait methods
    waitForLoadState: async (state, options = {}) => {
      await new Promise(r => setTimeout(r, 10));
      return true;
    },

    waitForNavigation: async (options = {}) => {
      await new Promise(r => setTimeout(r, 50));
      return { ok: true };
    },

    waitForFunction: async (fn, options = {}) => {
      await new Promise(r => setTimeout(r, 10));
      return true;
    },

    // Keyboard
    keyboard: {
      press: async (key) => {
        await new Promise(r => setTimeout(r, 10));
        return true;
      },
    },

    // Mouse
    mouse: {
      move: async (x, y) => {
        await new Promise(r => setTimeout(r, 10));
        return true;
      },
      wheel: async (deltaX, deltaY) => {
        state.scrollY += deltaY;
        await new Promise(r => setTimeout(r, 10));
        return true;
      },
    },

    // Screenshot
    screenshot: async (options = {}) => {
      if (state.isClosed) throw new Error('Page is closed');
      return Buffer.from('fake-screenshot-data');
    },

    // Frames
    frames: () => [mockPage],

    // Context
    context: () => ({
      newCDPSession: async () => ({
        send: async () => true,
      }),
    }),

    // Events
    on: (event, handler) => {
      // Mock event handler registration
    },
    off: (event, handler) => {
      // Mock event handler removal
    },

    // Close
    close: async () => {
      state.isClosed = true;
    },

    // Test helpers (not part of real API)
    _mockState: state,
    _addElement: (selector, element = {}) => {
      state.elementRefs.set(selector, element);
      const handle = {
        click: async () => true,
        type: async (text) => { element.value = text; },
        boundingBox: () => ({ x: 100, y: 100, width: 50, height: 30 }),
        evaluate: async (fn) => fn(handle),
        ...element,
        // Derived DOM-ish props so tests can read el.outerHTML / el.textContent
        outerHTML: element.html || element.outerHTML || '',
        textContent: element.text ?? element.textContent ?? element.value ?? '',
      };
      state.elements.set(selector, handle);
    },
    _setEvaluateResult: (fnString, result) => {
      state.evaluateResults.set(fnString, result);
    },
    _reset: () => {
      state.url = 'https://example.com';
      state.title = 'Example Page';
      state.isClosed = false;
      state.elements.clear();
      state.scrollY = 0;
      state.evaluateResults.clear();
    },
  };

  return mockPage;
}

export function createMockBrowser() {
  let pages = [];
  let isClosed = false;

  const mockBrowser = {
    newContext: async (options = {}) => {
      if (isClosed) throw new Error('Browser is closed');
      const context = {
        newPage: async () => {
          const page = createMockPage();
          pages.push(page);
          return page;
        },
        close: async () => {
          for (const page of pages) {
            await page.close();
          }
          pages = [];
        },
        pages: () => pages,
        on: () => {},
      };
      return context;
    },

    close: async () => {
      for (const page of pages) {
        await page.close();
      }
      pages = [];
      isClosed = true;
    },

    isConnected: () => !isClosed,

    process: () => ({
      pid: 12345,
      kill: (signal) => {
        isClosed = true;
      },
    }),

    _mockState: {
      get isClosed() { return isClosed; },
      get pages() { return pages; },
    },
  };

  return mockBrowser;
}

export function createMockState() {
  return {
    browserInstance: null,
    pageInstance: null,
    blockerInstance: null,
    setupPageFn: null,
    activeAnnotations: {},
    networkRecords: [],
    isRecordingNetwork: false,
    networkRecorderBoundPage: null,
    networkRecorderListeners: null,
    progressTasks: {},
    progressCallback: null,
    aiHealingEnabled: true,
  };
}
