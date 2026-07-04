import { chromium } from 'patchright';
import { createCursor } from 'ghost-cursor-patchright';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import * as fs from 'fs';
import * as path from 'path';
import { getHeadlessFromEnv } from '../mcp/handlers/state';
import type { Browser, Page } from 'patchright';

let adBlockerInstance: PlaywrightBlocker | null = null;
let adBlockerPromise: Promise<PlaywrightBlocker | null> | null = null;

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

export function getBraveExecutablePath(): string | null {
  if (process.env.BRAVE_PATH && fs.existsSync(process.env.BRAVE_PATH)) {
    return process.env.BRAVE_PATH;
  }

  const platform = process.platform;
  const { execSync } = require('child_process');

  if (platform === 'win32') {
    const regQueries = [
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe" /ve',
      'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe" /ve',
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Brave-Browser\\shell\\open\\command" /ve'
    ];

    for (const cmd of regQueries) {
      try {
        const output: string = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const match = output.match(/REG_SZ\s+(.*)/);
        if (match && match[1]) {
          let p = match[1].trim().replace(/^"|"$/g, '');
          if (!p.toLowerCase().endsWith('.exe')) {
            const exeIndex = p.toLowerCase().indexOf('.exe');
            if (exeIndex !== -1) {
              p = p.substring(0, exeIndex + 4).replace(/^"|"$/g, '');
            }
          }
          if (fs.existsSync(p)) return p;
        }
      } catch (e) {}
    }

    try {
      const output: string = execSync('where brave.exe', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\r\n')[0];
      if (output && fs.existsSync(output)) return output;
    } catch (e) {}
  } else if (platform === 'darwin') {
    try {
      const output: string = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.brave.Browser\'"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0];
      if (output) {
        const p = path.join(output, 'Contents', 'MacOS', 'Brave Browser');
        if (fs.existsSync(p)) return p;
      }
    } catch (e) {}
  } else {
    try {
      const output: string = execSync('which brave-browser || which brave', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (output && fs.existsSync(output)) return output;
    } catch (e) {}
  }

  let paths: string[] = [];
  if (platform === 'win32') {
    paths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    ].filter(p => p);
  } else if (platform === 'darwin') {
    paths = ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
  } else {
    paths = [
      '/usr/bin/brave-browser', '/usr/bin/brave', '/usr/bin/brave-browser-stable',
      '/usr/bin/brave-browser-beta', '/usr/bin/brave-browser-nightly',
      '/usr/local/bin/brave-browser', '/usr/local/bin/brave'
    ];
  }

  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }

  return null;
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
    headless = getDefaultHeadless(),
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

    const tempBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(executablePath ? { executablePath } : {}),
    });
    const tempContext = await tempBrowser.newContext();
    const tempPage = await tempContext.newPage();
    let nativeUa = '';
    let isBrave = false;
    try {
      nativeUa = await tempPage.evaluate(() => navigator.userAgent);
      isBrave = await tempPage.evaluate(() => typeof (navigator as any).brave !== 'undefined');
    } catch (e) {
      nativeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36';
      isBrave = !!(executablePath && executablePath.toLowerCase().includes('brave'));
    }
    await tempBrowser.close();

    let modifiedUa = nativeUa.replace(/HeadlessChrome\//g, 'Chrome/');
    const chromeVersionMatch = modifiedUa.match(/Chrome\/([\d.]+)/);
    const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '148.0.0.0';
    const majorVersion = chromeVersion.split('.')[0];

    const brands: Array<{ brand: string; version: string }> = [
      { brand: 'Chromium', version: majorVersion },
      { brand: 'Not/A)Brand', version: '99' }
    ];
    if (isBrave) {
      brands.unshift({ brand: 'Brave', version: majorVersion });
    } else {
      brands.unshift({ brand: 'Google Chrome', version: majorVersion });
    }

    let platformName = 'Windows';
    if (nativeUa.includes('Macintosh') || nativeUa.includes('Mac OS X')) {
      platformName = 'macOS';
    } else if (nativeUa.includes('Linux')) {
      platformName = 'Linux';
    }

    const fullVersionList: Array<{ brand: string; version: string }> = [
      { brand: 'Chromium', version: chromeVersion },
      { brand: 'Not/A)Brand', version: '99.0.0.0' }
    ];
    if (isBrave) {
      fullVersionList.unshift({ brand: 'Brave', version: chromeVersion });
    } else {
      fullVersionList.unshift({ brand: 'Google Chrome', version: chromeVersion });
    }

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
