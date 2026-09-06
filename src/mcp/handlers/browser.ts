import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, resolveWaitUntil, detachNetworkRecorderListeners } from './state';
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
      enableBlocker = getEnvBool('ENABLE_BLOCKER', true),
      recordVideo = false,
      aiHealing = getEnvBool('AI_HEALING', true),  // stored for use by click/type handlers
    } = params;
    // widgetAssist is the schema name; `turnstile` remains a deprecated alias
    // for backward compatibility (env TURNSTILE still works).
    const widgetAssist =
      (params as any).widgetAssist !== undefined
        ? (params as any).widgetAssist
        : (params as any).turnstile !== undefined
          ? (params as any).turnstile
          : getEnvBool('TURNSTILE', false);

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
      turnstile: widgetAssist,
      enableBlocker,
    });

    if (recordVideo) {
      notifyProgress('browser_init', 'progress', `Recording videos to: ${videosDir}`);
      try {
        ((result.page as any).context())._realBrowserRecording = true;
      } catch { /* ignore */ }
    }

    state.browserInstance = result.browser;
    state.pageInstance = result.page;
    state.blockerInstance = result.blocker;
    state.setupPageFn = result.setupPage;
    state.aiHealingEnabled = aiHealing; // stored for click/type handlers

    const { spoofFingerprint = true, blockWebRTCLeaks = true } = params;

    // Hook auto-switch for popup / target="_blank" new tabs
    try {
      const context = state.pageInstance?.context();
      if (context && !(context as any)._multiTabManaged) {
        (context as any)._multiTabManaged = true;
        context.on('page', async (newPage: any) => {
          notifyProgress('navigate', 'progress', `New tab opened: ${newPage.url() || 'about:blank'}`);
          state.pageInstance = newPage;
          try {
            if (state.setupPageFn) await state.setupPageFn(newPage);
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }

    if (state.pageInstance) {
      if (!(state.pageInstance as any)._realBrowserDialogBound) {
        (state.pageInstance as any)._realBrowserDialogBound = true;
      // Safety-first dialog policy:
      //   - alert()     → auto-dismissed (informational, non-destructive)
      //   - prompt()    → cancelled (return null)
      //   - confirm()   → DISMISSED by default (i.e. "Cancel") so destructive
      //     confirmations ("Delete everything?") are never auto-confirmed.
      //   - beforeunload → accepted (lets navigation proceed)
      // Redirect/external-navigation confirms are always dismissed.
      state.pageInstance.on('dialog', async (dialog: any) => {
        const dialogType = dialog.type();
        const msg = dialog.message().toLowerCase();

        notifyProgress('browser_init', 'progress',
          `🔔 Handling dialog: ${dialogType} - ${dialog.message().substring(0, 100)}...`);

        try {
          const isNavigationConfirm =
            msg.includes('redirect') || msg.includes('external') || msg.includes('leaving');
          if (dialogType === 'alert') {
            await dialog.dismiss();
          } else if (dialogType === 'beforeunload') {
            await dialog.accept();
          } else if (isNavigationConfirm) {
            console.error('🚫 Blocking redirect dialog (Dismiss)');
            await dialog.dismiss();
          } else {
            // confirm/prompt: cancel by default — never auto-confirm
            await dialog.dismiss();
          }
        } catch (e) {
          // Ignore errors (dialog might be closed by injected script)
        }
      });

      await state.pageInstance.addInitScript(() => {
        (window as any).originalConfirm = window.confirm;
        (window as any).originalAlert = window.alert;
        (window as any).originalPrompt = window.prompt;

        (window as any).confirm = (_msg?: string) => {
          // Never auto-confirm destructive actions; cancel by default.
          return false;
        };

        (window as any).alert = (_msg?: string) => {
          return undefined;
        };

        (window as any).prompt = (_msg?: string, _default?: string) => {
          return null;
        };
      });

      // Anti-detection: Hardware & WebGL Spoofing, AudioContext Jitter, WebRTC Protection
      if (spoofFingerprint || blockWebRTCLeaks) {
        await state.pageInstance.addInitScript(({ doSpoof, doWebRTC }: { doSpoof: boolean; doWebRTC: boolean }) => {
          if (doSpoof) {
            try {
              // WebGL Vendor / Renderer Spoofing
              const spoofVendor = (ctx: any) => {
                if (!ctx) return;
                const origGetParameter = ctx.prototype.getParameter;
                ctx.prototype.getParameter = function (param: number) {
                  // UNMASKED_VENDOR_WEBGL
                  if (param === 37445) return 'Google Inc. (NVIDIA)';
                  // UNMASKED_RENDERER_WEBGL
                  if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                  return origGetParameter.apply(this, [param]);
                };
              };
              if (window.WebGLRenderingContext) spoofVendor(window.WebGLRenderingContext);
              if (window.WebGL2RenderingContext) spoofVendor(window.WebGL2RenderingContext);

              // AudioContext micro-jitter to prevent static audio hash tracking
              if (window.AudioBuffer) {
                const origGetChannelData = AudioBuffer.prototype.getChannelData;
                AudioBuffer.prototype.getChannelData = function (channel: number) {
                  const data = origGetChannelData.apply(this, [channel]);
                  for (let i = 0; i < data.length; i += 100) {
                    data[i] += (Math.random() - 0.5) * 0.0000001;
                  }
                  return data;
                };
              }

              // Hardware Concurrency & Memory Consistency
              Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
              Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            } catch { /* ignore */ }
          }

          if (doWebRTC) {
            try {
              // WebRTC leak protection: sanitize local IP address leak in ICE candidates
              if (window.RTCPeerConnection) {
                const origCreateOffer = RTCPeerConnection.prototype.createOffer;
                RTCPeerConnection.prototype.createOffer = function (...args: any[]) {
                  return origCreateOffer.apply(this, args as any).then((offer: any) => {
                    if (offer && offer.sdp) {
                      // Strip private IPv4 patterns from SDP
                      offer.sdp = offer.sdp.replace(/(\d{1,3}\.){3}\d{1,3}/g, (ip: string) => {
                        if (ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
                          return '0.0.0.0';
                        }
                        return ip;
                      });
                    }
                    return offer;
                  });
                };
              }
            } catch { /* ignore */ }
          }
        }, { doSpoof: spoofFingerprint, doWebRTC: blockWebRTCLeaks });
      }
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
    const { tabAction = 'navigate', tabIndex } = params;

    // Multi-Tab & Window Management
    if (tabAction && tabAction !== 'navigate') {
      const contexts = state.browserInstance?.contexts() || [];
      const allPages = contexts.flatMap(c => c.pages());

      if (tabAction === 'list') {
        const tabs = await Promise.all(allPages.map(async (p, idx) => {
          let tabTitle = 'Unknown';
          try { tabTitle = await p.title(); } catch { /* ignore */ }
          return {
            index: idx,
            url: p.url(),
            title: tabTitle,
            active: p === state.pageInstance,
            isClosed: p.isClosed()
          };
        }));
        notifyProgress('navigate', 'completed', `Listed ${tabs.length} tabs`);
        return { success: true, count: tabs.length, tabs };
      }

      if (tabAction === 'switch') {
        if (tabIndex === undefined || tabIndex < 0 || tabIndex >= allPages.length) {
          throw new Error(`Invalid tabIndex: ${tabIndex}. Available tabs: 0 to ${allPages.length - 1}`);
        }
        const targetTab = allPages[tabIndex];
        await targetTab.bringToFront();
        state.pageInstance = targetTab;
        const title = await targetTab.title().catch(() => 'Unknown');
        notifyProgress('navigate', 'completed', `Switched to tab [${tabIndex}]: ${title}`);
        return { success: true, activeTabIndex: tabIndex, url: targetTab.url(), title };
      }

      if (tabAction === 'new') {
        // Determine whether video recording is active in the existing context so
        // the new tab inherits the same recording setup (recordVideo is per-context
        // in Playwright; new pages in the SAME context are recorded automatically,
        // but a freshly created context would not be).
        const targetContext = contexts[0] || await (state.browserInstance as any).newContext();
        const newTab = await targetContext.newPage();
        state.pageInstance = newTab;
        if (state.setupPageFn) {
          try { await state.setupPageFn(newTab); } catch { /* ignore */ }
        }
        notifyProgress('navigate', 'progress', 'Created new tab');
        if (params.url) {
          // If url provided, navigate to it
          await newTab.goto(params.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
        const title = await newTab.title().catch(() => 'New Tab');
        notifyProgress('navigate', 'completed', `New tab opened: ${title}`);
        return { success: true, url: newTab.url(), title, totalTabs: allPages.length + 1, videoRecording: (targetContext as any)._realBrowserRecording === true };
      }

      if (tabAction === 'close') {
        const targetTab = (tabIndex !== undefined && tabIndex >= 0 && tabIndex < allPages.length)
          ? allPages[tabIndex]
          : state.pageInstance;
        if (targetTab) {
          await targetTab.close();
          const remainingPages = contexts.flatMap(c => c.pages()).filter(p => !p.isClosed());
          if (remainingPages.length > 0) {
            state.pageInstance = remainingPages[0];
            await state.pageInstance.bringToFront().catch(() => {});
          } else {
            state.pageInstance = null;
          }
          notifyProgress('navigate', 'completed', 'Closed tab');
          return { success: true, closed: true, remainingTabs: remainingPages.length };
        }
      }
    }

    let { url = '', waitUntil = 'networkidle' as WaitUntilState, timeout = 30000, retries = 3, smartWait = true } = params;
    if (!url) {
      throw new Error('url parameter is required for navigation');
    }
    waitUntil = resolveWaitUntil(waitUntil) as WaitUntilState;

    const checkedUrl = await assertSafeUrl(url, 'navigate');
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

    // Detach network recorder listeners and stop recording before closing
    try {
      detachNetworkRecorderListeners();
    } catch { /* ignore */ }
    state.isRecordingNetwork = false;

    if (state.browserInstance) {
      try {
        // Explicitly close all active contexts to prevent orphaned background pages
        if (typeof (state.browserInstance as any).contexts === 'function') {
          const contexts = (state.browserInstance as any).contexts();
          for (const ctx of contexts) {
            try { await ctx.close(); } catch { /* ignore */ }
          }
        }
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

    // Reset memory state
    state.networkRecords = [];
    state.networkRecorderBoundPage = null;
    state.networkRecorderListeners = null;
    state.activeAnnotations = undefined;
    state.progressTasks = {};

    notifyProgress('browser_close', 'completed', 'Browser closed');

    return { success: true, message: 'Browser closed' };
  }
};
