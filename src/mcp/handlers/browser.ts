import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, resolveWaitUntil } from './state';
import { getEnvBool } from '../../shared/env-utils';
import { assertSafeUrl } from '../../shared/url-utils';
import type { BrowserInitParams, NavigateParams, WaitParams, WaitUntilState } from '../../types';

export const browserHandlers = {
  async browser_init(params: BrowserInitParams = {}) {
    notifyProgress('browser_init', 'started', 'Initializing browser...');

    // Self-healing: if a previous browser session exists but is dead/stale
    // (page crashed or was closed externally), tear it down before starting a
    // fresh one. Without this, the old instance kept every following tool call
    // hanging until the MCP client gave up with "-32001 Request timed out".
    try {
      const stalePage = state.pageInstance as any;
      const staleBrowser = state.browserInstance as any;
      const pageClosed = stalePage ? (typeof stalePage.isClosed === 'function' && stalePage.isClosed()) : true;
      const browserConnected = staleBrowser ? (typeof staleBrowser.isConnected === 'function' && staleBrowser.isConnected()) : false;
      if ((state.browserInstance || state.pageInstance) && (pageClosed || !browserConnected)) {
        notifyProgress('browser_init', 'progress', 'Stale browser session detected, cleaning up...');
        try {
          if (typeof staleBrowser?.close === 'function') {
            await Promise.race([
              staleBrowser.close(),
              new Promise(r => setTimeout(r, 8000)),
            ]);
          }
        } catch (e) {
          try {
            if (typeof staleBrowser?.process === 'function') staleBrowser.process()?.kill('SIGKILL');
          } catch { /* ignore */ }
        }
        state.browserInstance = null;
        state.pageInstance = null;
        state.blockerInstance = null;
        state.setupPageFn = null;
      }
    } catch (e) {
      notifyProgress('browser_init', 'progress', `Stale cleanup check failed (${(e as Error)?.message || e}), continuing...`);
    }

    const { connect } = require('../../../lib/cjs/index.js') as { connect: Function };

    const envHeadless = getHeadlessFromEnv();
    const headless = params.headless !== undefined ? params.headless : envHeadless;

    const {
      proxy = {} as Record<string, unknown>,
      contextOptions = {} as Record<string, unknown>,
      turnstile = getEnvBool('TURNSTILE', false),
      enableBlocker = getEnvBool('ENABLE_BLOCKER', true),
      recordVideo = false,
      aiHealing = getEnvBool('AI_HEALING', true),  // stored for use by click/type handlers
    } = params;

    notifyProgress('browser_init', 'progress', `Mode: ${headless ? 'Headless' : 'GUI (Visible)'}`, { headless });

    const mergedContextOptions: Record<string, unknown> = contextOptions;

    // Videos go to the OS temp dir (or REAL_BROWSER_VIDEO_DIR) so they never
    // depend on the server's CWD. Creating ./videos relative to dist/ broke
    // on npx/global installs and left orphaned files in the project tree.
    const videosDir = process.env.REAL_BROWSER_VIDEO_DIR
      ? path.resolve(process.env.REAL_BROWSER_VIDEO_DIR)
      : path.join(os.tmpdir(), 'real-browser-mcp', 'videos');
    try {
      fs.mkdirSync(videosDir, { recursive: true });
    } catch { /* ignore — context creation will fail loudly if unwritable */ }

    const result = await connect({
      headless,
      proxy,
      contextOptions: recordVideo ? { ...mergedContextOptions, recordVideo: { dir: videosDir } } : mergedContextOptions,
      turnstile,
      enableBlocker,
    });

    if (recordVideo) {
      notifyProgress('browser_init', 'progress', `Recording videos to: ${videosDir}`);
    }

    state.browserInstance = result.browser;
    state.pageInstance = result.page;
    state.blockerInstance = result.blocker;
    state.setupPageFn = result.setupPage;
    state.aiHealingEnabled = aiHealing; // stored for click/type handlers

    if (state.pageInstance) {
      if (!(state.pageInstance as any)._realBrowserDialogBound) {
        (state.pageInstance as any)._realBrowserDialogBound = true;
      state.pageInstance.on('dialog', async (dialog: any) => {
        const dialogType = dialog.type();
        const msg = dialog.message().toLowerCase();

        notifyProgress('browser_init', 'progress',
          `🔔 Handling dialog: ${dialogType} - ${dialog.message().substring(0, 100)}...`);

        try {
          if (msg.includes('redirect') || msg.includes('external') || msg.includes('leaving')) {
            console.error('🚫 Blocking redirect dialog (Dismiss)');
            await dialog.dismiss();
          } else {
            await dialog.accept();
          }
        } catch (e) {
          // Ignore errors (dialog might be closed by injected script)
        }
      });

      await state.pageInstance.addInitScript(() => {
        (window as any).originalConfirm = window.confirm;
        (window as any).originalAlert = window.alert;

        (window as any).confirm = (msg?: string) => {
          if (msg && (msg.toLowerCase().includes('redirect') || msg.toLowerCase().includes('external'))) {
            return false;
          }
          return true;
        };

        (window as any).alert = (_msg?: string) => {
          return undefined;
        };

        (window as any).prompt = (_msg?: string, _default?: string) => {
          return null;
        };
      });
      }
    }

    const pid = (typeof (state.browserInstance as any).process === 'function') ? (state.browserInstance as any).process()?.pid : null;

    notifyProgress('browser_init', 'completed', `Browser started (PID: ${pid})`, {
      headless,
      pid,
      blockerEnabled: enableBlocker,
      aiHealingEnabled: aiHealing,
    });

    return {
      success: true,
      message: `Browser initialized in ${headless ? 'headless' : 'GUI'} mode`,
      pid,
      headless,
      blockerEnabled: enableBlocker,
      aiHealingEnabled: aiHealing,
    };
  },

  async navigate(params: NavigateParams) {
    const { page } = requireBrowser();
    let { url, waitUntil = 'networkidle' as WaitUntilState, timeout = 30000, retries = 3, smartWait = true } = params;
    waitUntil = resolveWaitUntil(waitUntil) as WaitUntilState;

    const checkedUrl = assertSafeUrl(url, 'navigate');
    if (checkedUrl.valid) url = checkedUrl.url;

    notifyProgress('navigate', 'started', `Navigating to: ${url}`);

    if (state.setupPageFn) {
      try {
        await state.setupPageFn(page);
        notifyProgress('navigate', 'progress', 'CDP early injection setup complete');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        notifyProgress('navigate', 'progress', `CDP early injection failed: ${msg}`);
      }
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          notifyProgress('navigate', 'progress', `Retry attempt ${attempt}...`);
          await new Promise(r => setTimeout(r, 1000));
        }

        await page.goto(url, { waitUntil, timeout });

        if (smartWait) {
          try {
            await page.waitForFunction(() => {
              const body = document.body;
              if (!body) return false;
              const text = body.innerText || '';
              return text.length > 50 && !body.querySelector('.loading, .spinner, [class*="loading"]');
            }, { timeout: 5000 });
          } catch {
            // Smart wait timeout — page may still be loading, continue
          }
        }

        await new Promise(r => setTimeout(r, 500));

        let title = '';
        try {
          title = await page.title();
        } catch (e) {
          title = 'Loading...';
        }

        notifyProgress('navigate', 'completed', `Loaded: ${title}`, { url: page.url(), title });

        return { success: true, url: page.url(), title };
      } catch (error: unknown) {
        lastError = error;
        const errMsg = error instanceof Error ? error.message : String(error);

        if (errMsg.includes('Execution context was destroyed') ||
          errMsg.includes('Execution context of the page was destroyed') ||
          errMsg.includes('Target closed') ||
          errMsg.includes('navigating')) {

          notifyProgress('navigate', 'progress', `Navigation interrupted (${errMsg.substring(0, 50)}...), waiting for page...`);

          try {
            await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' as const }).catch(() => {});
          } catch (e) {
            // Ignore timeout
          }

          try {
            const currentUrl = page.url();
            if (currentUrl && currentUrl !== 'about:blank') {
              const title = await page.title().catch(() => 'Unknown');
              notifyProgress('navigate', 'completed', `Loaded after recovery: ${title}`, { url: currentUrl, title });
              return { success: true, url: currentUrl, title, recovered: true };
            }
          } catch (e) {
            // Continue to retry
          }
        }

        // Every other failure (net::ERR_*, DNS, timeout, connection refused,
        // aborted, 5xx…) is retryable: log it and let the retry loop continue.
        // Only after ALL attempts are exhausted do we throw (below the loop).
        if (attempt < retries) {
          notifyProgress('navigate', 'progress', `Attempt ${attempt + 1}/${retries + 1} failed: ${errMsg.substring(0, 120)} — retrying...`);
        }
      }
    }

    const lastErrMsg = lastError instanceof Error ? lastError.message : String(lastError);
    notifyProgress('navigate', 'error', `Navigation failed after ${retries + 1} attempts: ${lastErrMsg}`);
    throw lastError || new Error('Navigation failed');
  },

  async wait(params: WaitParams) {
    const { page } = requireBrowser();
    const { type = 'timeout', value, timeout = 30000 } = params;

    notifyProgress('wait', 'started', `Waiting for ${type}: ${value}`);

    switch (type) {
      case 'selector':
        await page.waitForSelector(value!, { timeout });
        break;
      case 'navigation':
        await page.waitForNavigation({ timeout });
        break;
      case 'networkidle':
        await page.waitForLoadState('networkidle', { timeout });
        break;
      case 'timeout':
      default:
        await new Promise(r => setTimeout(r, parseInt(value || '1000') || 1000));
    }

    notifyProgress('wait', 'completed', `Wait completed: ${type}`, { type, value });

    return { success: true, type, value };
  },

  async browser_close(params: Record<string, unknown> = {}) {
    const { force = false } = params as { force?: boolean };

    notifyProgress('browser_close', 'started', 'Closing browser...');

    if (state.browserInstance) {
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
