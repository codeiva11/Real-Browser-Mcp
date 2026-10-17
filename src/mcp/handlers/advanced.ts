// Advanced tools: Cloudflare bypass, downloads, sessions, console capture,
// smart form fill, performance metrics, visual comparison.
import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress } from './state';
import { helpersHandlers } from './helpers';
import { assertSafeUrl } from '../../shared/url-utils';
import type {
  CloudflareBypassParams,
  DownloadManagerParams,
  SessionManagerParams,
  ConsoleLogsParams,
  FillFormParams,
  PerformanceMetricsParams,
  CompareScreenshotsParams,
} from '../../types';

/** Resolve a user-supplied save path, preventing path traversal outside cwd. */
function safeResolve(savePath: string): string | null {
  const resolved = path.resolve(savePath);
  const cwd = path.resolve(process.cwd());
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return null;
  return resolved;
}

function isChallengePage(title: string, hasStage: boolean): boolean {
  return title.includes('Just a moment') || hasStage;
}

/** Best-effort session autosave; safe to call from any handler. */
export async function maybeAutosaveSession(): Promise<void> {
  if (!state.sessionAutosave) return;
  try {
    const { page } = requireBrowser();
    const url: string = page.url();
    if (!url.startsWith('http')) return;
    const cookies = await page.context().cookies().catch(() => []);
    const payload = {
      savedAt: new Date().toISOString(),
      cookies,
      url,
      localStorage: {},
      sessionStorage: {},
    };
    const resolved = safeResolve('session.autosave.json');
    if (resolved) {
      fs.writeFileSync(resolved, JSON.stringify(payload));
      state.sessionLastSavedAt = payload.savedAt;
      state.sessionLastUrl = url;
    }
  } catch { /* autosave is best-effort */ }
}

export const advancedHandlers = {
  /**
   * Navigate to a URL and automatically wait for a Cloudflare (or similar)
   * JS challenge to clear. Returns solved status + clearance cookies that a
   * plain HTTP client can replay.
   */
  async cloudflare_bypass(params: CloudflareBypassParams) {
    const { page } = requireBrowser();
    const {
      url,
      timeout = 90000,
      pollInterval = 2000,
      exportCookies = true,
      waitUntil = 'domcontentloaded',
    } = params || {};
    if (!url) return { success: false, error: 'url is required' };
    await assertSafeUrl(url, 'cloudflare_bypass');

    notifyProgress('cloudflare_bypass', 'started', `Navigating to ${url}`);
    const navTimeout = Math.min(60000, timeout);
    await page.goto(url, { waitUntil: waitUntil as any, timeout: navTimeout }).catch((e: any) => {
      notifyProgress('cloudflare_bypass', 'progress', `Navigation note: ${e.message}`);
    });

    const start = Date.now();
    let solved = false;
    let attempts = 0;
    let lastTitle = '';
    while (Date.now() - start < timeout) {
      attempts++;
      const probe: any = await page.evaluate(() => ({
        title: document.title,
        challengeStage: !!document.querySelector('#challenge-stage'),
        turnstile: !!document.querySelector('.cf-turnstile, input[name="cf-turnstile-response"]'),
        bodyText: (document.body ? document.body.innerText : '').substring(0, 120),
      })).catch(() => null);
      if (!probe) break;
      lastTitle = probe.title;
      if (!isChallengePage(probe.title, probe.challengeStage)) {
        solved = true;
        break;
      }
      if (attempts === 1) {
        notifyProgress('cloudflare_bypass', 'progress', 'Challenge detected, waiting for auto-solve...');
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    let cookies: any[] = [];
    let cookieHeader = '';
    if (exportCookies) {
      try {
        const all = await page.context().cookies();
        cookies = all.filter((c: any) => /cf_|__cf|clearance/i.test(c.name));
        cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
      } catch { /* cookie export is best-effort */ }
    }

    const elapsedMs = Date.now() - start;
    notifyProgress(
      'cloudflare_bypass',
      solved ? 'completed' : 'error',
      solved ? `Challenge cleared in ${elapsedMs}ms` : `Challenge NOT cleared after ${elapsedMs}ms`
    );
    return {
      success: true,
      solved,
      finalUrl: page.url(),
      title: lastTitle || (await page.title().catch(() => '')),
      attempts,
      elapsedMs,
      cookies,
      cookieHeader,
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => ''),
    };
  },

  /**
   * Manage browser downloads: wait for the next download to complete and save
   * it inside the working directory, or list/clear recorded downloads.
   */
  async download_manager(params: DownloadManagerParams) {
    const { page } = requireBrowser();
    const { action = 'list', timeout = 60000, saveDir = 'downloads', filename } = params || {};

    if (action === 'list') {
      return { success: true, monitoring: !!(state as any)._downloadMonitoring, downloads: state.downloads || [] };
    }
    if (action === 'clear') {
      state.downloads = [];
      return { success: true, message: 'Download history cleared' };
    }

    const dir = safeResolve(saveDir);
    if (!dir) return { success: false, error: 'saveDir is outside the working directory (path traversal blocked).' };
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const saveDownload = async (download: any) => {
      let suggested = 'download.bin';
      try {
        const s = download.suggestedFilename();
        suggested = typeof s?.then === 'function' ? await s : s;
      } catch { /* keep default */ }
      const safeName = (filename || suggested).replace(/[^a-zA-Z0-9._-]/g, '_');
      const savePath = path.join(dir, safeName);
      await download.saveAs(savePath);
      let dlUrl = '';
      try { dlUrl = download.url(); } catch { /* optional */ }
      const record = { filename: safeName, path: savePath, url: dlUrl, savedAt: new Date().toISOString() };
      state.downloads = state.downloads || [];
      state.downloads.push(record);
      notifyProgress('download_manager', 'completed', `Download saved: ${safeName}`);
      return record;
    };

    if (action === 'monitor') {
      if (!(state as any)._downloadMonitoring) {
        const onDownload = (download: any) => {
          notifyProgress('download_manager', 'progress', 'Download event received');
          saveDownload(download).catch((e: any) =>
            notifyProgress('download_manager', 'error', `Download save failed: ${e.message}`)
          );
        };
        (page as any).on('download', onDownload);
        (state as any)._downloadMonitoring = true;
        (state as any)._downloadListener = onDownload;
        (state as any)._downloadSaveDir = dir;
      }
      return { success: true, message: `Auto-saving downloads to ${saveDir}`, monitoring: true };
    }
    if (action === 'stop_monitor') {
      const l = (state as any)._downloadListener;
      if (l) { try { (page as any).off('download', l); } catch {} }
      (state as any)._downloadMonitoring = false;
      (state as any)._downloadListener = null;
      return { success: true, message: 'Download auto-save stopped', monitoring: false };
    }
    if (action !== 'wait') {
      return { success: false, error: `Unknown action: ${action}. Supported: monitor, stop_monitor, wait, list, clear` };
    }

    notifyProgress('download_manager', 'started', 'Waiting for download to start...');
    const download: any = await page.waitForEvent('download', { timeout }).catch(() => null);
    if (!download) {
      return { success: false, error: `No download started within ${timeout}ms` };
    }
    const record = await saveDownload(download);
    return { success: true, ...record };
  },

  /**
   * Persist and restore browsing sessions (cookies + storage). Autosave hooks
   * into navigation; recover replays the last autosave after a crash.
   */
  async session_manager(params: SessionManagerParams) {
    const { action = 'info', sessionPath = 'session.json', autosave } = params || {};

    if (action === 'autosave') {
      state.sessionAutosave = autosave !== false;
      return { success: true, autosave: state.sessionAutosave };
    }
    if (action === 'info') {
      return {
        success: true,
        autosave: !!state.sessionAutosave,
        lastSavedAt: state.sessionLastSavedAt || null,
        lastUrl: state.sessionLastUrl || null,
      };
    }

    const resolved = safeResolve(sessionPath);
    if (!resolved) return { success: false, error: 'sessionPath is outside the working directory (path traversal blocked).' };

    if (action === 'save') {
      const { page } = requireBrowser();
      const cookies = await page.context().cookies().catch(() => []);
      const storage: any = await page.evaluate(() => {
        const ls: Record<string, string> = {};
        const ss: Record<string, string> = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)!;
            ls[k] = localStorage.getItem(k) || '';
          }
        } catch {}
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i)!;
            ss[k] = sessionStorage.getItem(k) || '';
          }
        } catch {}
        return { localStorage: ls, sessionStorage: ss, url: location.href };
      }).catch(() => ({ localStorage: {}, sessionStorage: {}, url: '' }));
      const payload = { savedAt: new Date().toISOString(), cookies, ...storage };
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, JSON.stringify(payload, null, 2));
      state.sessionLastSavedAt = payload.savedAt;
      state.sessionLastUrl = storage.url;
      notifyProgress('session_manager', 'completed', `Session saved (${cookies.length} cookies)`);
      return { success: true, path: resolved, cookieCount: cookies.length, url: storage.url };
    }

    if (action === 'load' || action === 'recover') {
      if (!fs.existsSync(resolved)) {
        return { success: false, error: `Session file not found: ${sessionPath}` };
      }
      const { page } = requireBrowser();
      const payload = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      if (Array.isArray(payload.cookies) && payload.cookies.length > 0) {
        await page.context().addCookies(payload.cookies).catch((e: any) => {
          notifyProgress('session_manager', 'progress', `Cookie restore note: ${e.message}`);
        });
      }
      // Storage restore needs a page on the right origin; navigate there first
      // if we have a saved URL and the current page is blank.
      const targetUrl: string = payload.url || '';
      if (targetUrl && targetUrl.startsWith('http') && page.url() === 'about:blank') {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
      await page.evaluate((s: any) => {
        try {
          Object.entries(s.localStorage || {}).forEach(([k, v]) => localStorage.setItem(k, v as string));
        } catch {}
        try {
          Object.entries(s.sessionStorage || {}).forEach(([k, v]) => sessionStorage.setItem(k, v as string));
        } catch {}
      }, { localStorage: payload.localStorage, sessionStorage: payload.sessionStorage }).catch(() => {});
      notifyProgress('session_manager', 'completed', 'Session restored');
      return { success: true, restoredUrl: targetUrl, cookieCount: (payload.cookies || []).length };
    }

    return { success: false, error: `Unknown action: ${action}. Supported: save, load, autosave, recover, info` };
  },

  /** Called by the navigate handler after a successful navigation (autosave hook). */
  async _maybeAutosaveSession() {
    await maybeAutosaveSession();
  },

  /**
   * Capture page console messages and uncaught page errors.
   */
  async console_logs(params: ConsoleLogsParams) {
    const { page } = requireBrowser();
    const { action = 'get', level, limit = 200, clearAfterGet = false } = params || {};

    if (action === 'start') {
      if (!state.consoleListening) {
        // NOTE: page.on('console') does not fire in patchright's headless
        // shell (Runtime domain isn't auto-enabled). Raw CDP works.
        const cdp: any = await page.context().newCDPSession(page).catch(() => null);
        if (!cdp) return { success: false, error: 'Could not open CDP session for console capture' };
        const push = (entry: any) => {
          state.consoleLogs = state.consoleLogs || [];
          state.consoleLogs.push({ ...entry, at: new Date().toISOString() });
          if (state.consoleLogs.length > 2000) state.consoleLogs.splice(0, state.consoleLogs.length - 2000);
        };
        const onConsoleAPICalled = (e: any) => {
          const text = (e.args || [])
            .map((a: any) => (a.value !== undefined ? String(a.value) : (a.description || a.type || '')))
            .join(' ')
            .substring(0, 2000);
          push({ kind: 'console', level: e.type || 'log', text, url: e.stackTrace?.callFrames?.[0]?.url || '' });
        };
        const onExceptionThrown = (e: any) => {
          const d = e.exceptionDetails || {};
          push({
            kind: 'pageerror',
            level: 'error',
            text: String(d.text || d.exception?.description || 'uncaught exception').substring(0, 2000),
            url: d.url || '',
          });
        };
        cdp.on('Runtime.consoleAPICalled', onConsoleAPICalled);
        cdp.on('Runtime.exceptionThrown', onExceptionThrown);
        await cdp.send('Runtime.enable').catch(() => {});
        state.consoleListeners = { cdp, onConsoleAPICalled, onExceptionThrown };
        state.consoleListening = true;
      }
      return { success: true, message: 'Console capture started (CDP)' };
    }
    if (action === 'stop') {
      const l: any = state.consoleListeners;
      if (l) {
        try { l.cdp.off('Runtime.consoleAPICalled', l.onConsoleAPICalled); } catch {}
        try { l.cdp.off('Runtime.exceptionThrown', l.onExceptionThrown); } catch {}
        try { await l.cdp.send('Runtime.disable').catch(() => {}); } catch {}
        try { await l.cdp.detach().catch(() => {}); } catch {}
      }
      state.consoleListeners = null;
      state.consoleListening = false;
      return { success: true, message: 'Console capture stopped' };
    }
    if (action === 'clear') {
      state.consoleLogs = [];
      return { success: true, message: 'Console logs cleared' };
    }
    if (action !== 'get') {
      return { success: false, error: `Unknown action: ${action}. Supported: start, stop, get, clear` };
    }
    let logs = state.consoleLogs || [];
    if (level) logs = logs.filter((l: any) => l.level === level);
    const out = logs.slice(-limit);
    if (clearAfterGet) state.consoleLogs = [];
    return { success: true, count: out.length, listening: !!state.consoleListening, logs: out };
  },

  /**
   * Smart form filling exposed as a first-class tool (previously only
   * reachable via solve_captcha's formData passthrough).
   */
  async fill_form(params: FillFormParams) {
    const { page } = requireBrowser();
    const {
      formData,
      formSelector,
      submit = false,
      humanLike = true,
      aiMatch = true,
      pressEnter = false,
    } = params || {};
    if (!formData || typeof formData !== 'object' || Object.keys(formData).length === 0) {
      return { success: false, error: 'formData (object of field->value) is required' };
    }
    notifyProgress('fill_form', 'started', `Filling ${Object.keys(formData).length} fields...`);
    const result: any = await helpersHandlers._fillFormFields(page, formData, formSelector, humanLike, aiMatch);
    let submitted: any = null;
    if (submit) {
      notifyProgress('fill_form', 'progress', 'Submitting form...');
      submitted = await helpersHandlers._submitForm(page).catch((e: any) => ({ success: false, message: e.message }));
    } else if (pressEnter) {
      await page.keyboard.press('Enter').catch(() => {});
    }
    notifyProgress('fill_form', 'completed', 'Form fill finished');
    return { success: true, fields: Object.keys(formData), fillResult: result, submitted };
  },

  /**
   * Web performance metrics for the current page: Navigation Timing,
   * paint timings, and buffered Web Vitals (LCP/CLS) where available.
   */
  async performance_metrics(params: PerformanceMetricsParams) {
    const { page } = requireBrowser();
    const data: any = await page.evaluate(() => {
      const nav: any = performance.getEntriesByType('navigation')[0] as any;
      const paints: Record<string, number> = {};
      performance.getEntriesByType('paint').forEach((p: any) => { paints[p.name] = Math.round(p.startTime); });
      let lcp = -1;
      try {
        performance.getEntriesByType('largest-contentful-paint').forEach((e: any) => {
          lcp = Math.max(lcp, Math.round(e.startTime));
        });
      } catch {}
      let cls = 0;
      try {
        (performance.getEntriesByType('layout-shift') as any[]).forEach((e: any) => {
          if (!e.hadRecentInput) cls += e.value;
        });
        cls = Math.round(cls * 1000) / 1000;
      } catch {}
      const resources = performance.getEntriesByType('resource').length;
      return {
        url: location.href,
        navigation: nav ? {
          ttfbMs: Math.round(nav.responseStart - nav.requestStart),
          domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          loadMs: Math.round(nav.loadEventEnd - nav.startTime),
          transferBytes: nav.transferSize || 0,
        } : null,
        paints,
        webVitals: { lcpMs: lcp, cls, inpMs: -1 },
        resourceCount: resources,
        domElements: document.querySelectorAll('*').length,
      };
    }).catch((e: any) => ({ error: e.message }));
    if ((data as any).error) return { success: false, error: (data as any).error };
    return { success: true, ...data };
  },

  /**
   * Visual comparison: baseline stores a screenshot; compare diffs the current
   * viewport against it and returns a difference percentage.
   */
  async compare_screenshots(params: CompareScreenshotsParams) {
    const { page } = requireBrowser();
    const { action = 'compare', threshold = 1.0, fullPage = false } = params || {};

    const shot = await page.screenshot({ fullPage, type: 'png' }).catch((e: any) => null);
    if (!shot) return { success: false, error: 'Screenshot capture failed' };

    if (action === 'baseline') {
      state.visualBaseline = shot;
      state.visualBaselineAt = new Date().toISOString();
      notifyProgress('compare_screenshots', 'completed', 'Baseline captured');
      return { success: true, action: 'baseline', bytes: shot.length, capturedAt: state.visualBaselineAt };
    }
    if (action !== 'compare') {
      return { success: false, error: `Unknown action: ${action}. Supported: baseline, compare` };
    }
    if (!state.visualBaseline) {
      return { success: false, error: 'No baseline captured yet. Run action=baseline first.' };
    }
    // Pixel diff done page-side via canvas: both PNGs are decoded by the
    // browser itself (no native image deps needed), downscaled to 320px,
    // then sampled per-pixel.
    const diff: any = await page.evaluate(
      async ({ baselineB64, currentB64 }: any) => {
        const load = (b64: string) => new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error('image decode failed'));
          img.src = 'data:image/png;base64,' + b64;
        });
        const [a, b] = await Promise.all([load(baselineB64), load(currentB64)]);
        const w = Math.min(a.width, b.width, 320);
        const h = Math.min(a.height, b.height, 320);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true })!;
        const grab = (img: HTMLImageElement) => {
          cx.clearRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          return cx.getImageData(0, 0, w, h).data;
        };
        const da = grab(a); const db = grab(b);
        let diffPx = 0;
        const total = w * h;
        for (let i = 0; i < da.length; i += 16) {
          const dr = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (dr > 48) diffPx++;
        }
        const sampled = total / 4;
        return {
          width: w, height: h,
          diffPercent: Math.round((diffPx / sampled) * 10000) / 100,
        };
      },
      {
        baselineB64: Buffer.from(state.visualBaseline).toString('base64'),
        currentB64: shot.toString('base64'),
      }
    ).catch((e: any) => ({ error: e.message }));
    if ((diff as any).error) return { success: false, error: (diff as any).error };

    return {
      success: true,
      action: 'compare',
      diffPercent: (diff as any).diffPercent,
      exceedsThreshold: (diff as any).diffPercent > threshold,
      threshold,
      comparedAt: new Date().toISOString(),
    };
  },
};
