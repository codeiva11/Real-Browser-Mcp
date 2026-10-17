// Internal core-engine helpers (NOT exposed as tools).
// These power features integrated into the existing 21 tools:
//  - Cloudflare challenge auto-bypass  -> navigate(waitForChallenge)
//  - Download auto-save               -> browser_init(downloadDir)
//  - Session persistence              -> storage_inspector(save/load_session)
//  - Console capture                  -> core (always-on) + deep_analysis
//  - Performance metrics              -> deep_analysis
//  - Visual baseline/compare          -> see_page
import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress } from './state';

/** Resolve a user-supplied save path, preventing path traversal outside cwd. */
export function safeResolve(savePath: string): string | null {
  const resolved = path.resolve(savePath);
  const cwd = path.resolve(process.cwd());
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return null;
  return resolved;
}

/**
 * Convert a user-friendly glob (`*example.com*`, `** /*.png`, full URLs) to a
 * predicate. Playwright's native glob has a quirk where a leading single `*`
 * never matches the scheme+host part, so `*example.com*` matches nothing.
 */
export function globToUrlPredicate(pattern: string): (url: string) => boolean {
  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const re = new RegExp(`^${regexStr}$`, 'i');
  return (url: string) => re.test(url);
}

function isChallengePage(title: string, hasStage: boolean): boolean {
  return title.includes('Just a moment') || hasStage;
}

/**
 * Core: wait for a Cloudflare-style JS challenge to clear on the current page.
 * Used by navigate(waitForChallenge). Returns solved status + clearance cookies.
 */
export async function waitForChallengeToClear(
  page: any,
  timeout = 90000,
  pollInterval = 2000
): Promise<{ solved: boolean; attempts: number; elapsedMs: number; cookies: any[]; cookieHeader: string; title: string }> {
  const start = Date.now();
  let solved = false;
  let attempts = 0;
  let lastTitle = '';
  while (Date.now() - start < timeout) {
    attempts++;
    const probe: any = await page.evaluate(() => ({
      title: document.title,
      challengeStage: !!document.querySelector('#challenge-stage'),
    })).catch(() => null);
    if (!probe) break;
    lastTitle = probe.title;
    if (!isChallengePage(probe.title, probe.challengeStage)) {
      solved = true;
      break;
    }
    if (attempts === 1) {
      notifyProgress('navigate', 'progress', 'Challenge detected, waiting for auto-solve...');
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  let cookies: any[] = [];
  let cookieHeader = '';
  try {
    const all = await page.context().cookies();
    cookies = all.filter((c: any) => /cf_|__cf|clearance/i.test(c.name));
    cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
  } catch { /* best-effort */ }

  return {
    solved,
    attempts,
    elapsedMs: Date.now() - start,
    cookies,
    cookieHeader,
    title: lastTitle || (await page.title().catch(() => '')),
  };
}

/** Best-effort session autosave; safe to call from any handler. */
export async function maybeAutosaveSession(): Promise<void> {
  if (!state.sessionAutosave) return;
  try {
    const { page } = requireBrowser();
    const url: string = page.url();
    if (!url.startsWith('http')) return;
    const cookies = await page.context().cookies().catch(() => []);
    const payload = { savedAt: new Date().toISOString(), cookies, url, localStorage: {}, sessionStorage: {} };
    const resolved = safeResolve('session.autosave.json');
    if (resolved) {
      fs.writeFileSync(resolved, JSON.stringify(payload));
      state.sessionLastSavedAt = payload.savedAt;
      state.sessionLastUrl = url;
    }
  } catch { /* autosave is best-effort */ }
}

/** Save full session (cookies + storage) to a file. Used by storage_inspector. */
/** Start CDP-based console capture (always-on core). */
export async function startConsoleCapture(page: any): Promise<{ success: boolean; error?: string }> {
  if (state.consoleListening) return { success: true };
  // NOTE: page.on('console') does not fire in patchright's headless shell
  // (Runtime domain isn't auto-enabled). Raw CDP works.
  const cdp: any = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) return { success: false, error: 'Could not open CDP session' };
  const push = (entry: any) => {
    state.consoleLogs = state.consoleLogs || [];
    state.consoleLogs.push({ ...entry, at: new Date().toISOString() });
    if (state.consoleLogs.length > 2000) state.consoleLogs.splice(0, state.consoleLogs.length - 2000);
  };
  const onConsoleAPICalled = (e: any) => {
    const text = (e.args || []).map((a: any) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ').substring(0, 2000);
    push({ kind: 'console', level: e.type || 'log', text, url: e.stackTrace?.callFrames?.[0]?.url || '' });
  };
  const onExceptionThrown = (e: any) => {
    const d = e.exceptionDetails || {};
    push({ kind: 'pageerror', level: 'error', text: String(d.text || 'uncaught exception').substring(0, 2000), url: d.url || '' });
  };
  cdp.on('Runtime.consoleAPICalled', onConsoleAPICalled);
  cdp.on('Runtime.exceptionThrown', onExceptionThrown);
  await cdp.send('Runtime.enable').catch(() => {});
  state.consoleListeners = { cdp, onConsoleAPICalled, onExceptionThrown };
  state.consoleListening = true;
  return { success: true };
}

/** Collect web performance metrics for the current page. */
export async function collectPerformanceMetrics(page: any): Promise<any> {
  return page.evaluate(() => {
    const nav: any = performance.getEntriesByType('navigation')[0] as any;
    const paints: Record<string, number> = {};
    performance.getEntriesByType('paint').forEach((p: any) => { paints[p.name] = Math.round(p.startTime); });
    let lcp = -1;
    try { performance.getEntriesByType('largest-contentful-paint').forEach((e: any) => { lcp = Math.max(lcp, Math.round(e.startTime)); }); } catch {}
    let cls = 0;
    try {
      (performance.getEntriesByType('layout-shift') as any[]).forEach((e: any) => { if (!e.hadRecentInput) cls += e.value; });
      cls = Math.round(cls * 1000) / 1000;
    } catch {}
    return {
      url: location.href,
      navigation: nav ? {
        ttfbMs: Math.round(nav.responseStart - nav.requestStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadMs: Math.round(nav.loadEventEnd - nav.startTime),
        transferBytes: nav.transferSize || 0,
      } : null,
      paints,
      webVitals: { lcpMs: lcp, cls },
      resourceCount: performance.getEntriesByType('resource').length,
      domElements: document.querySelectorAll('*').length,
    };
  }).catch((e: any) => ({ error: e.message }));
}

/** Page-side visual diff between two PNG screenshots (no native deps). */
export async function diffScreenshots(page: any, baselineB64: string, currentB64: string): Promise<any> {
  return page.evaluate(
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
      return { width: w, height: h, diffPercent: Math.round((diffPx / (total / 4)) * 10000) / 100 };
    },
    { baselineB64, currentB64 }
  ).catch((e: any) => ({ error: e.message }));
}
