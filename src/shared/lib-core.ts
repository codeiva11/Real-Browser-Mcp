import { chromium } from 'patchright';
import { createCursor } from 'ghost-cursor-patchright';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getHeadlessFromEnv } from './env-utils';
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
 */
function buildUserAgent(): string {
  const isMac = os.platform() === 'darwin';
  const isWin = os.platform() === 'win32';
  const osString = isMac
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : isWin
    ? 'Windows NT 10.0; Win64; x64'
    : 'X11; Linux x86_64';

  const chromiumVersion = getPatchrightChromiumVersion() || '149.0.7827.55';

  return `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVersion} Safari/537.36`;
}

function resolveAdBlockerCachePath(): string {
  // Built output lives in dist/src/shared; bundled filter cache is lib/cjs/adblocker.bin.
  const bundledPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'cjs', 'adblocker.bin');
  if (fs.existsSync(bundledPath)) return bundledPath;
  return path.join(__dirname, 'adblocker.bin');
}

function getAdBlocker(): Promise<PlaywrightBlocker | null> {
  if (!adBlockerPromise) {
    const cachePath = resolveAdBlockerCachePath();
    adBlockerPromise = PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    }).then((blocker: PlaywrightBlocker) => {
      adBlockerInstance = blocker;
      return blocker;
    }).catch((err: Error) => {
      console.error('[adblocker] Failed to initialize adblocker:', err.message);
      return null;
    });
  }
  return adBlockerPromise;
}

export function getDefaultHeadless(): boolean {
  return getHeadlessFromEnv();
}

export { getHeadlessFromEnv };

export function setupRealPage(browser: Browser, page: Page & Record<string, any>, enableBlocker = true): Page & Record<string, any> {
  if ((page as any)._setupApplied) return page;
  (page as any)._setupApplied = true;

  if (enableBlocker) {
    if (adBlockerInstance) {
      adBlockerInstance.enableBlockingInPage(page as any).catch(() => {});
    } else {
      getAdBlocker().then((blocker: PlaywrightBlocker | null) => {
        if (blocker) {
          blocker.enableBlockingInPage(page as any).catch(() => {});
        }
      });
    }
  }

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
    // No disk cache — avoids stale HeadlessChrome UA strings being reused.
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
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
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

    if (enableBlocker) {
      await getAdBlocker();
    }

    const context = await browser.newContext({
      viewport: null,
      ...contextOptions,
    });

    let page: Page = await context.newPage();

    await applyUserAgentOverride(page, ua, userAgentMetadata as any);

    setupRealPage(browser, page, enableBlocker);

    page = await pageController({
      browser,
      page,
      proxy,
      turnstile,
    });

    context.on('page', async (newPage: Page) => {
      await applyUserAgentOverride(newPage, ua, userAgentMetadata as any);
      setupRealPage(browser, newPage, enableBlocker);
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
        setupRealPage(browser, p, enableBlocker);
      }
    };
  };
}
