import { chromium } from 'patchright';
import { createCursor } from 'ghost-cursor-patchright';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getHeadlessFromEnv, shouldDisableChromiumSandbox } from './env-utils';
import type { Browser, Page } from 'patchright';

let adBlockerInstance: PlaywrightBlocker | null = null;
let adBlockerPromise: Promise<PlaywrightBlocker | null> | null = null;

/**
 * Resolve the current patchright-core Chromium version from browsers.json.
 * require.resolve('patchright-core') returns .../patchright-core/index.js
 * dirname() gives us the patchright-core/ directory directly (1 level up).
 */
function getPatchrightChromiumVersion(): string {
  try {
    const coreDir = path.dirname(require.resolve('patchright-core'));
    const browsersJsonPath = path.join(coreDir, 'browsers.json');
    if (fs.existsSync(browsersJsonPath)) {
      const browsersJson = JSON.parse(fs.readFileSync(browsersJsonPath, 'utf8'));
      const chromiumObj = browsersJson.browsers.find((b: any) => b.name === 'chromium' || b.name === 'chrome');
      if (chromiumObj && chromiumObj.browserVersion) return chromiumObj.browserVersion;
    }
  } catch { /* ignore */ }
  // Fallback: search in node_modules relative to cwd
  try {
    const altPath = path.join(process.cwd(), 'node_modules', 'patchright-core', 'browsers.json');
    if (fs.existsSync(altPath)) {
      const browsersJson = JSON.parse(fs.readFileSync(altPath, 'utf8'));
      const chromiumObj = browsersJson.browsers.find((b: any) => b.name === 'chromium' || b.name === 'chrome');
      if (chromiumObj && chromiumObj.browserVersion) return chromiumObj.browserVersion;
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Build the UA string using patchright's actual Chromium version.
 * Always uses 'Chrome/' (never 'HeadlessChrome/') so WAFs don't flag it.
 *
 * Dynamic override: REAL_BROWSER_USER_AGENT (or the per-connect
 * contextOptions.userAgent) replaces the generated UA. A comma-separated
 * list ("ua1,ua2") rotates per connect() call so long-running scrapers can
 * vary their fingerprint across sessions.
 */
const uaOverridePool: string[] | null = (() => {
  const raw = process.env.REAL_BROWSER_USER_AGENT;
  if (!raw || !raw.trim()) return null;
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean);
})();
let uaRotationIndex = 0;

function buildUserAgent(): string {
  const isMac = os.platform() === 'darwin';
  const isWin = os.platform() === 'win32';
  const osString = isMac
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : isWin
    ? 'Windows NT 10.0; Win64; x64'
    : 'X11; Linux x86_64';

  const chromiumVersion = getPatchrightChromiumVersion() || '149.0.7827.55';
  const generated = `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVersion} Safari/537.36`;

  if (uaOverridePool && uaOverridePool.length > 0) {
    const ua = uaOverridePool[uaRotationIndex % uaOverridePool.length];
    uaRotationIndex++;
    return ua;
  }

  return generated;
}

function resolveAdBlockerCachePath(): string {
  // Built output lives in dist/src/shared; bundled filter cache is lib/cjs/adblocker.bin.
  const bundledPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'cjs', 'adblocker.bin');
  if (fs.existsSync(bundledPath)) return bundledPath;
  // Dev/source tree fallback: project-root lib/cjs relative to cwd.
  const cwdPath = path.join(process.cwd(), 'lib', 'cjs', 'adblocker.bin');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return path.join(__dirname, 'adblocker.bin');
}

/**
 * Initialize the adblocker singleton.
 * FIX: On failure, reset adBlockerPromise to null so the next call can retry
 * instead of being permanently stuck with a resolved-null promise.
 */
function getAdBlocker(): Promise<PlaywrightBlocker | null> {
  if (!adBlockerPromise) {
    const cachePath = resolveAdBlockerCachePath();

    // Cache writes must never take down blocking: a read-only install dir
    // (global/npx installs) would otherwise reject the whole promise and
    // silently disable the adblocker. Writes are best-effort; reads fall
    // back to a network fetch of the prebuilt lists.
    const safeWrite = async (filePath: string, data: Uint8Array) => {
      try {
        await fs.promises.writeFile(filePath, data);
      } catch (e: any) {
        console.error('[adblocker] Cache write failed (blocking continues in-memory):', e?.message || e);
      }
    };

    adBlockerPromise = (async (): Promise<PlaywrightBlocker | null> => {
      try {
        const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
          path: cachePath,
          read: fs.promises.readFile,
          write: safeWrite,
        });
        adBlockerInstance = blocker;
        return blocker;
      } catch (err: any) {
        console.error('[adblocker] Cache read failed, falling back to network fetch:', err?.message || err);
        try {
          const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
          adBlockerInstance = blocker;
          return blocker;
        } catch (err2: any) {
          console.error('[adblocker] Failed to initialize adblocker:', err2?.message || err2);
          // Reset so the next connect() call can retry
          adBlockerPromise = null;
          return null;
        }
      }
    })();
  }
  return adBlockerPromise;
}

/**
 * Enable ad blocking on a page. Awaitable — caller knows blocking is active
 * before proceeding to navigate.
 */
async function enableBlockingInPage(page: Page): Promise<void> {
  try {
    if (adBlockerInstance) {
      await adBlockerInstance.enableBlockingInPage(page as any);
    } else {
      const blocker = await getAdBlocker();
      if (blocker) await blocker.enableBlockingInPage(page as any);
    }
  } catch (e) {
    // Page may have been closed — ignore silently
  }
}

export function getDefaultHeadless(): boolean {
  return getHeadlessFromEnv();
}

export { getHeadlessFromEnv };

export function setupRealPage(page: Page & Record<string, any>): Page & Record<string, any> {
  if ((page as any)._setupApplied) return page;
  (page as any)._setupApplied = true;

  page.realScroll = async (deltaY: number, duration = 600) => {
    try {
      const stepDelay = 15;
      const steps = Math.max(10, Math.floor(duration / stepDelay));
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      let currentScroll = 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const targetScroll = deltaY * easeOutCubic(t);
        const diff = targetScroll - currentScroll;
        await page.mouse.wheel(0, diff);
        currentScroll = targetScroll;
        await new Promise(r => setTimeout(r, stepDelay));
      }
    } catch (e) {
      try {
        await page.evaluate((y: number) => window.scrollBy({ top: y, behavior: 'smooth' }), deltaY);
      } catch (_) {}
    }
  };

  try {
    const cursor = createCursor(page);
    page.realCursor = {
      move: async (selector: string, options: Record<string, unknown> = {}) => {
        try {
          await (cursor as any).actions.move(selector, options);
        } catch (e) {
          try { await page.hover(selector); } catch (_) {}
        }
      }
    };
    page.realClick = async (selector: string, options: Record<string, unknown> = {}) => {
      try {
        await (cursor as any).actions.click({ target: selector, ...options });
      } catch (e) {
        await page.click(selector, options as any);
      }
    };
  } catch (e) {
    if (!page.realClick) {
      page.realClick = async (selector: string, options: Record<string, unknown>) => {
        await page.click(selector, options as any);
      };
    }
    if (!page.realCursor) {
      page.realCursor = {
        move: async (selector: string) => {
          try { await page.hover(selector); } catch (_) {}
        }
      };
    }
  }

  return page;
}

export async function applyUserAgentOverride(page: Page, userAgent: string, userAgentMetadata: any): Promise<void> {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setUserAgentOverride', {
      userAgent,
      userAgentMetadata
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Calculate the correct "GREASE" brand string for a given Chrome major version.
 * Chrome rotates through 3 grease strings based on majorVersion % 3,
 * mirroring Chromium's actual GetGreasedUserAgentBrandList() algorithm.
 */
function getGreaseBrand(majorVersion: number): string {
  const greaseBrands = ['Not/A)Brand', 'Not A;Brand', 'Not?A_Brand'];
  return greaseBrands[majorVersion % 3];
}

export function createConnect(pageController: (opts: { browser: Browser; page: Page; proxy: Record<string, unknown>; turnstile: boolean }) => Promise<Page>) {
  return async function connect({
    args = [],
    headless = getHeadlessFromEnv(),
    proxy = {} as Record<string, unknown>,
    contextOptions = {} as Record<string, unknown>,
    turnstile = false,
    enableBlocker = true,
    executablePath = undefined as string | undefined,
  } = {}) {
    let playwrightProxy: Record<string, unknown> | undefined = undefined;
    if (proxy && proxy.host && proxy.port) {
      playwrightProxy = {
        server: `${proxy.host}:${proxy.port}`
      };
      if (proxy.username && proxy.password) {
        playwrightProxy.username = proxy.username;
        playwrightProxy.password = proxy.password;
      }
    }

    // Build UA fresh every time from patchright's actual Chromium version.
    const ua = buildUserAgent();

    const chromeVersionMatch = ua.match(/Chrome\/([\d.]+)/);
    const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '149.0.7827.55';
    const majorVersion = parseInt(chromeVersion.split('.')[0], 10);
    const majorVersionStr = String(majorVersion);

    const greaseBrand = getGreaseBrand(majorVersion);

    const brands: Array<{ brand: string; version: string }> = [
      { brand: 'Google Chrome', version: majorVersionStr },
      { brand: 'Chromium', version: majorVersionStr },
      { brand: greaseBrand, version: '24' }
    ];

    let platformName = 'Windows';
    if (ua.includes('Macintosh') || ua.includes('Mac OS X')) {
      platformName = 'macOS';
    } else if (ua.includes('Linux')) {
      platformName = 'Linux';
    }

    const fullVersionList: Array<{ brand: string; version: string }> = [
      { brand: 'Google Chrome', version: chromeVersion },
      { brand: 'Chromium', version: chromeVersion },
      { brand: greaseBrand, version: '24.0.0.0' }
    ];

    // Platform version: Windows 11 → "15.0.0", macOS Sonoma → "14.0.0", Linux → "6.6.0"
    let platformVersion = '15.0.0';
    if (platformName === 'macOS') platformVersion = '14.0.0';
    else if (platformName === 'Linux') platformVersion = '6.6.0';

    const userAgentMetadata: Record<string, unknown> = {
      brands,
      fullVersionList,
      fullVersion: chromeVersion,
      mobile: false,
      platform: platformName,
      platformVersion,
      architecture: 'x86',
      model: '',
      bitness: '64',
      wow64: false
    };

    const chromiumArgs = [
      `--user-agent=${ua}`,
      '--disable-blink-features=AutomationControlled',
      // FIX: only disable the Chromium sandbox when required (CI, containers,
      // root). On normal desktops the OS-level sandbox stays enabled — it is a
      // strong security boundary for untrusted page content.
      ...(shouldDisableChromiumSandbox() ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      // FIX: removed --window-size — it caused browser to open maximized/fullscreen.
      // Browser window size is controlled by the OS/user, not forced by the server.
      '--disable-dev-shm-usage',
      ...args
    ];

    let launchHeadless: boolean = headless;
    if (headless === true) {
      launchHeadless = false;
      if (!chromiumArgs.includes('--headless=new')) {
        chromiumArgs.push('--headless=new');
      }
    }

    const browser = await chromium.launch({
      headless: launchHeadless,
      args: chromiumArgs,
      proxy: playwrightProxy as any,
      ...(executablePath ? { executablePath } : {}),
    });

    // FIX: await adblocker init BEFORE creating the page so enableBlockingInPage
    // is called synchronously on adBlockerInstance (fast path), not via a
    // fire-and-forget then() that may lose the race with first navigation.
    if (enableBlocker) {
      await getAdBlocker();
    }

    const context = await browser.newContext({
      viewport: null,
      ...contextOptions,
    });

    let page: Page = await context.newPage();

    await applyUserAgentOverride(page, ua, userAgentMetadata as any);

    // FIX: await blocking setup so it is fully active before pageController runs
    setupRealPage(page);
    if (enableBlocker) await enableBlockingInPage(page);

    page = await pageController({
      browser,
      page,
      proxy,
      turnstile,
    });

    // FIX: new pages from window.open / target=_blank also get full setup + blocking
    context.on('page', async (newPage: Page) => {
      await applyUserAgentOverride(newPage, ua, userAgentMetadata as any);
      setupRealPage(newPage);
      if (enableBlocker) await enableBlockingInPage(newPage);
      await pageController({
        browser,
        page: newPage,
        proxy,
        turnstile,
      });
    });

    return {
      browser,
      page,
      blocker: adBlockerInstance,
      setupPage: async (p: Page) => {
        await applyUserAgentOverride(p, ua, userAgentMetadata as any);
        setupRealPage(p);
        if (enableBlocker) await enableBlockingInPage(p);
      }
    };
  };
}
