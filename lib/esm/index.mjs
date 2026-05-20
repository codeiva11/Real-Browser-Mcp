import playwright from "playwright-ghost/patchright";
import recommended from "playwright-ghost/plugins/recommended";
const { chromium } = playwright;
import { PlaywrightBlocker } from "@ghostery/adblocker-playwright";
import { pageController } from "./module/pageController.mjs";
import { fileURLToPath } from 'url';
import Xvfb from "xvfb";
import * as fs from 'fs';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let adBlockerInstance = null;
let adBlockerPromise = null;
function getAdBlocker() {
  if (!adBlockerPromise) {
    const cachePath = path.join(__dirname, 'adblocker.bin');
    adBlockerPromise = PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    }).then(blocker => {
      adBlockerInstance = blocker;
      return blocker;
    }).catch(err => {
      console.error('[adblocker] Failed to initialize adblocker:', err.message);
      return null;
    });
  }
  return adBlockerPromise;
}

function loadEnvFile() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
  ];

  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath) && !envPaths.includes(envPath)) {
      envPaths.push(envPath);
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            if (key && !process.env[key]) {
              process.env[key] = value;
            }
          }
        });
        break;
      }
    } catch (error) {
      // Silently ignore .env loading errors
    }
  }
}

loadEnvFile();

function getDefaultHeadless() {
  const envHeadless = (process.env.HEADLESS || '').toLowerCase();
  return envHeadless === 'true';
}

function applyPuppeteerShims(browser, page) {
  if (page._shimsApplied) return page;
  page._shimsApplied = true;

  // Enable ad blocker
  if (adBlockerInstance) {
    adBlockerInstance.enableBlockingInPage(page).catch(() => {});
  } else {
    getAdBlocker().then(blocker => {
      if (blocker) {
        blocker.enableBlockingInPage(page).catch(() => {});
      }
    });
  }

  // Cookie shims (Puppeteer → Playwright context)
  if (!page.cookies) {
    page.cookies = async (urls) => {
      return await page.context().cookies(urls ? (Array.isArray(urls) ? urls : [urls]) : []);
    };
  }

  if (!page.setCookie) {
    page.setCookie = async (...cookies) => {
      const formatted = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || new URL(page.url()).hostname,
        path: c.path || '/',
        expires: c.expires || undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite
      }));
      await page.context().addCookies(formatted);
    };
  }

  if (!page.deleteCookie) {
    page.deleteCookie = async (...cookies) => {
      await page.context().clearCookies();
    };
  }

  // Navigation shims
  if (!page.waitForNetworkIdle) {
    page.waitForNetworkIdle = async (options = {}) => {
      try {
        await page.waitForLoadState('networkidle', { timeout: options.timeout });
      } catch (e) {
        // Ignore networkidle timeouts if they are non-fatal
      }
    };
  }

  if (!page.evaluateOnNewDocument) {
    page.evaluateOnNewDocument = async (fn, ...args) => {
      return await page.addInitScript(fn, ...args);
    };
  }

  // Ghost Cursor integration via playwright-ghost auto-hooking
  page.realCursor = {
    move: async (selector, options = {}) => {
      try {
        await page.hover(selector, options);
      } catch (e) {
        // Silently fallback if element is not found
      }
    }
  };
  page.realClick = async (selector, options = {}) => {
    await page.click(selector, options);
  };

  // Mouse wheel shim (Puppeteer object → Playwright positional args)
  if (page.mouse && page.mouse.wheel) {
    const originalWheel = page.mouse.wheel.bind(page.mouse);
    page.mouse.wheel = async (x, y) => {
      if (typeof x === 'object' && x !== null) {
        const deltaX = x.deltaX || 0;
        const deltaY = x.deltaY || 0;
        return await originalWheel(deltaX, deltaY);
      }
      return await originalWheel(x, y);
    };
  }

  // Browser shims
  if (!browser.process) {
    browser.process = () => ({
      pid: browser._childProcess?.pid || 1337
    });
  }

  if (!browser.pages) {
    browser.pages = async () => {
      return browser.contexts().flatMap(c => c.pages());
    };
  }

  return page;
}

export async function connect({
  args = [],
  headless = getDefaultHeadless(),
  proxy = {},
  turnstile = false,
  disableXvfb = false,
} = {}) {
  let xvfbInstance = null;
  if (process.platform === 'linux' && !process.env.DISPLAY && !disableXvfb) {
    try {
      xvfbInstance = new Xvfb({
        silent: true,
        xvfb_args: ['-screen', '0', '1280x1024x24', '-ac']
      });
      xvfbInstance.startSync();
    } catch (err) {
      console.error('[xvfb] Failed to start Xvfb server automatically:', err.message);
    }
  }

  let playwrightProxy = undefined;
  if (proxy && proxy.host && proxy.port) {
    playwrightProxy = {
      server: `${proxy.host}:${proxy.port}`
    };
    if (proxy.username && proxy.password) {
      playwrightProxy.username = proxy.username;
      playwrightProxy.password = proxy.password;
    }
  }

  const chromiumArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    ...args
  ];

  const browser = await chromium.launch({
    headless,
    args: chromiumArgs,
    proxy: playwrightProxy,
    plugins: [recommended()]
  });

  if (xvfbInstance) {
    browser.on('disconnected', () => {
      try {
        xvfbInstance.stopSync();
      } catch (e) {
        console.error('[xvfb] Failed to stop Xvfb server:', e.message);
      }
    });
    const originalClose = browser.close.bind(browser);
    browser.close = async () => {
      await originalClose();
      try {
        xvfbInstance.stopSync();
      } catch (e) {
        console.error('[xvfb] Failed to stop Xvfb server during close:', e.message);
      }
    };
  }

  // Ensure ad blocker is ready
  await getAdBlocker();

  const context = await browser.newContext({
    viewport: null,
  });

  let page = await context.newPage();

  applyPuppeteerShims(browser, page);

  page = await pageController({
    browser,
    page,
    proxy,
    turnstile,
  });

  context.on('page', async (newPage) => {
    applyPuppeteerShims(browser, newPage);
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
  };
}
