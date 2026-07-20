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

// Cache the detected user-agent string so we don't launch a temp browser on every connect().
// Stored in the OS temp directory (never inside the project / cwd) so the project tree
// stays clean and we don't pollute the user's working directory.
let cachedNativeUa: string | null = null;
const UA_CACHE_DIR = path.join(os.tmpdir(), 'real-browser-mcp');
const UA_CACHE_FILE = path.join(UA_CACHE_DIR, 'ua-cache.txt');

function loadCachedUa(): string | null {
  try {
    if (fs.existsSync(UA_CACHE_FILE)) {
      const ua = fs.readFileSync(UA_CACHE_FILE, 'utf8').trim();
      if (ua && ua.includes('Chrome/')) return ua;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCachedUa(ua: string): void {
  try {
    if (!fs.existsSync(UA_CACHE_DIR)) fs.mkdirSync(UA_CACHE_DIR, { recursive: true });
    fs.writeFileSync(UA_CACHE_FILE, ua, 'utf8');
  } catch { /* ignore */ }
}

async function getNativeUserAgent(executablePath?: string): Promise<string> {
  // Return in-memory cache first
  if (cachedNativeUa) return cachedNativeUa;

  // Return disk cache if available and no custom executablePath
  if (!executablePath) {
    const diskCached = loadCachedUa();
    if (diskCached) {
      cachedNativeUa = diskCached;
      return cachedNativeUa;
    }
  }

  // Launch temp browser only when cache misses
  try {
    const tempBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(executablePath ? { executablePath } : {}),
    });
    const tempContext = await tempBrowser.newContext();
    const tempPage = await tempContext.newPage();
    const ua = await tempPage.evaluate(() => navigator.userAgent);
    await tempBrowser.close();
    cachedNativeUa = ua;
    if (!executablePath) saveCachedUa(ua);
    return ua;
  } catch (e) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36';
  }
}

function getAdBlocker(): Promise<PlaywrightBlocker | null> {
  if (!adBlockerPromise) {
    const cachePath = path.join(__dirname, 'adblocker.bin');
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

export function setupRealPage(browser: Browser, page: Page & Record<string, any>): Page & Record<string, any> {
  if ((page as any)._setupApplied) return page;
  (page as any)._setupApplied = true;

  if (adBlockerInstance) {
    adBlockerInstance.enableBlockingInPage(page as any).catch(() => {});
  } else {
    getAdBlocker().then((blocker: PlaywrightBlocker | null) => {
      if (blocker) {
        blocker.enableBlockingInPage(page as any).catch(() => {});
      }
    });
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

export function createConnect(pageController: (opts: { browser: Browser; page: Page; proxy: Record<string, unknown>; turnstile: boolean }) => Promise<Page>) {
  return async function connect({
    args = [],
    headless = getHeadlessFromEnv(),
    proxy = {} as Record<string, unknown>,
    contextOptions = {} as Record<string, unknown>,
    turnstile = false,
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

    // Use cached UA — avoids launching an extra browser every time
    const nativeUa = await getNativeUserAgent(executablePath);

    let modifiedUa = nativeUa.replace(/HeadlessChrome\//g, 'Chrome/');
    const chromeVersionMatch = modifiedUa.match(/Chrome\/([\d.]+)/);
    const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '148.0.0.0';
    const majorVersion = chromeVersion.split('.')[0];

    const brands: Array<{ brand: string; version: string }> = [
      { brand: 'Google Chrome', version: majorVersion },
      { brand: 'Chromium', version: majorVersion },
      { brand: 'Not/A)Brand', version: '99' }
    ];

    let platformName = 'Windows';
    if (nativeUa.includes('Macintosh') || nativeUa.includes('Mac OS X')) {
      platformName = 'macOS';
    } else if (nativeUa.includes('Linux')) {
      platformName = 'Linux';
    }

    const fullVersionList: Array<{ brand: string; version: string }> = [
      { brand: 'Google Chrome', version: chromeVersion },
      { brand: 'Chromium', version: chromeVersion },
      { brand: 'Not/A)Brand', version: '99.0.0.0' }
    ];

    const userAgentMetadata: Record<string, unknown> = {
      brands,
      fullVersionList,
      fullVersion: chromeVersion,
      mobile: false,
      platform: platformName,
      platformVersion: platformName === 'macOS' ? '14.0.0' : platformName === 'Linux' ? '6.0.0' : '10.0.0',
      architecture: 'x86',
      model: '',
      bitness: '64',
      wow64: false
    };

    const chromiumArgs = [
      `--user-agent=${modifiedUa}`,
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
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

    await getAdBlocker();

    const context = await browser.newContext({
      viewport: null,
      ...contextOptions,
    });

    let page: Page = await context.newPage();

    await applyUserAgentOverride(page, modifiedUa, userAgentMetadata as any);

    setupRealPage(browser, page);

    page = await pageController({
      browser,
      page,
      proxy,
      turnstile,
    });

    context.on('page', async (newPage: Page) => {
      await applyUserAgentOverride(newPage, modifiedUa, userAgentMetadata as any);
      setupRealPage(browser, newPage);
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
        await applyUserAgentOverride(p, modifiedUa, userAgentMetadata as any);
        setupRealPage(browser, p);
      }
    };
  };
}
