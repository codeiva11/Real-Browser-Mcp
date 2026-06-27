// @ts-nocheck

import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil, globalCache } from './state';


// Auto-generated browser handlers

export const browserHandlers = {
  async browser_init(params = {}) {
    notifyProgress('browser_init', 'started', 'Initializing browser...');

    const { connect } = require('../../../lib/cjs/index.js');

    // Get headless from params OR environment variable
    const envHeadless = getHeadlessFromEnv();
    const headless = params.headless !== undefined ? params.headless : envHeadless;

    const { proxy = {}, contextOptions = {}, turnstile = false, enableBlocker = true, recordVideo = false } = params;

    notifyProgress('browser_init', 'progress', `Mode: ${headless ? 'Headless' : 'GUI (Visible)'}`, { headless });

    // Load storage state from globalCache
    const savedStorage = globalCache.get('storage_state');
    const mergedContextOptions = savedStorage
      ? { ...contextOptions, storageState: savedStorage }
      : contextOptions;

    const result = await connect({
      headless,
      proxy,
      contextOptions: recordVideo ? { ...mergedContextOptions, recordVideo: { dir: './videos' } } : mergedContextOptions,
      turnstile,
      enableBlocker,
    });

    state.browserInstance = result.browser;
    state.pageInstance = result.page;
    state.blockerInstance = result.blocker;
    state.setupPageFn = result.setupPage; // Store CDP early injection function

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL DIALOG HANDLER - Auto-handle dialogs
    // Logic: BLOCK redirects to external sites, ACCEPT everything else
    // ═══════════════════════════════════════════════════════════════
    state.pageInstance.on('dialog', async (dialog) => {
      const dialogType = dialog.type();
      const msg = dialog.message().toLowerCase();

      notifyProgress('browser_init', 'progress',
        `🔔 Handling dialog: ${dialogType} - ${dialog.message().substring(0, 100)}...`);

      try {
        // Critical Fix: BLOCK redirects to external sites (e.g., eCommittee)
        // These redirects take the user away from the search page
        if (msg.includes('redirect') || msg.includes('external') || msg.includes('leaving')) {
          console.error('🚫 Blocking redirect dialog (Dismiss)');
          await dialog.dismiss(); // Simulate clicking 'Cancel'
        } else {
          // Auto-accept other dialogs (like alerts or simple confirmations)
          await dialog.accept(); // Simulate clicking 'OK'
        }
      } catch (e) {
        // Ignore errors (dialog might be closed by injected script)
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // INJECTED SCRIPT - Silent Handling of Popups
    // Override window.confirm/alert to handle them inside the page context
    // Note: Using addInitScript (Playwright) to intercept popups early
    // ═══════════════════════════════════════════════════════════════
    await state.pageInstance.addInitScript(() => {
      window.originalConfirm = window.confirm;
      window.originalAlert = window.alert;

      // Smart Confirm Handler
      window.confirm = (msg) => {
        console.log('Intercepted Confirm Dialog:', msg);
        if (msg && (msg.toLowerCase().includes('redirect') || msg.toLowerCase().includes('external'))) {
          console.log('🚫 Blocking redirect confirmation inside page');
          return false; // Return FALSE = Click Cancel
        }
        return true; // Return TRUE = Click OK
      };

      // Silently ignore alerts (always OK)
      window.alert = (msg) => {
        console.log('Blocked Alert Dialog:', msg);
        return true;
      };

      // Silently return null for prompts
      window.prompt = (msg) => {
        console.log('Blocked Prompt Dialog:', msg);
        return null;
      };
    });

    const pid = (typeof (state.browserInstance as any).process === 'function') ? (state.browserInstance as any).process()?.pid : null;

    notifyProgress('browser_init', 'completed', `Browser started (PID: ${pid})`, {
      headless,
      pid,
      blockerEnabled: enableBlocker
    });

    return {
      success: true,
      message: `Browser initialized in ${headless ? 'headless' : 'GUI'} mode`,
      pid,
      headless,
      blockerEnabled: enableBlocker
    };
  },

  async navigate(params) {
    const { page } = requireBrowser();
    let { url, waitUntil = 'networkidle', timeout = 30000, retries = 2 } = params;
    // Playwright/Patchright wait states: load | domcontentloaded | networkidle | commit
    waitUntil = resolveWaitUntil(waitUntil);

    notifyProgress('navigate', 'started', `Navigating to: ${url}`);

    // ═══════════════════════════════════════════════════════════════
    // CDP EARLY INJECTION - Setup BEFORE navigation for better ad blocking
    // This ensures CSS and scripts are injected before page scripts run
    // ═══════════════════════════════════════════════════════════════
    console.error('[Navigate] state.setupPageFn available:', !!state.setupPageFn);
    if (state.setupPageFn) {
      try {
        await state.setupPageFn(page);
        notifyProgress('navigate', 'progress', 'CDP early injection setup complete');
        console.error('[Navigate] CDP early injection SUCCESS');
      } catch (e) {
        // Non-critical error, continue navigation
        console.error('[Navigate] CDP early injection failed:', e.message);
      }
    } else {
      console.error('[Navigate] No state.setupPageFn available - CDP early injection skipped');
    }

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Wait a bit if this is a retry
        if (attempt > 0) {
          notifyProgress('navigate', 'progress', `Retry attempt ${attempt}...`);
          await new Promise(r => setTimeout(r, 1000));
        }

        await page.goto(url, { waitUntil, timeout });

        // Wait for page to stabilize after navigation
        await new Promise(r => setTimeout(r, 500));

        // Try to get title with error handling
        let title = '';
        try {
          title = await page.title();
        } catch (e) {
          // Title might fail if page is still loading
          title = 'Loading...';
        }

        notifyProgress('navigate', 'completed', `Loaded: ${title}`, { url: page.url(), title });

        return {
          success: true,
          url: page.url(),
          title
        };
      } catch (error) {
        lastError = error;

        // Handle specific errors that might be recoverable
        if (error.message?.includes('Execution context was destroyed') ||
          error.message?.includes('context') ||
          error.message?.includes('Target closed')) {

          notifyProgress('navigate', 'progress', `Navigation interrupted (${error.message.substring(0, 50)}...), waiting for page...`);

          // Wait for any ongoing navigation to complete
          try {
            await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => { });
          } catch (e) {
            // Ignore timeout
          }

          // Check if we actually landed on the page
          try {
            const currentUrl = page.url();
            if (currentUrl && currentUrl !== 'about:blank') {
              const title = await page.title().catch(() => 'Unknown');
              notifyProgress('navigate', 'completed', `Loaded after recovery: ${title}`, { url: currentUrl, title });
              return {
                success: true,
                url: currentUrl,
                title,
                recovered: true
              };
            }
          } catch (e) {
            // Continue to retry
          }
        } else {
          // Non-recoverable error, throw immediately
          throw error;
        }
      }
    }

    // All retries failed
    notifyProgress('navigate', 'error', `Navigation failed after ${retries + 1} attempts: ${lastError?.message}`);
    throw lastError || new Error('Navigation failed');
  },

  async wait(params) {
    const { page } = requireBrowser();
    const { type = 'timeout', value, timeout = 30000 } = params;

    notifyProgress('wait', 'started', `Waiting for ${type}: ${value}`);

    switch (type) {
      case 'selector':
        await page.waitForSelector(value, { timeout });
        break;
      case 'navigation':
        await page.waitForNavigation({ timeout });
        break;
      case 'networkidle':
        await page.waitForLoadState('networkidle', { timeout });
        break;
      case 'timeout':
      default:
        await new Promise(r => setTimeout(r, parseInt(value) || 1000));
    }

    notifyProgress('wait', 'completed', `Wait completed: ${type}`, { type, value });

    return { success: true, type, value };
  },

  async browser_close(params = {}) {
    const { force = false } = params;

    notifyProgress('browser_close', 'started', 'Closing browser...');

    if (state.browserInstance) {
      // Save storage state to globalCache before closing
      if (state.pageInstance) {
        try {
          const storageState = await state.pageInstance.context().storageState();
          globalCache.set('storage_state', storageState);
          globalCache.saveToDisk();
        } catch (e) {
          // ignore error
        }
      }

      try {
        await state.browserInstance.close();
        notifyProgress('browser_close', 'progress', 'Browser closed gracefully');
      } catch (e) {
        if (force) {
          if (typeof (state.browserInstance as any).process === 'function') {
            (state.browserInstance as any).process()?.kill('SIGKILL');
          }
          notifyProgress('browser_close', 'progress', 'Browser force killed');
        }
      }
      state.browserInstance = null;
      state.pageInstance = null;
      state.blockerInstance = null;
      state.setupPageFn = null;
    }

    notifyProgress('browser_close', 'completed', 'Browser closed');

    return { success: true, message: 'Browser closed' };
  }
};
