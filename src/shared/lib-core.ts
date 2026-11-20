import { chromium } from 'patchright';
import { createCursor } from 'ghost-cursor-patchright';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { getHeadlessFromEnv, shouldDisableChromiumSandbox } from './env-utils';
import type { Browser, Page } from 'patchright';

let adBlockerInstance: PlaywrightBlocker | null = null;
let adBlockerPromise: Promise<PlaywrightBlocker | null> | null = null;

/**
 * Resolve the current patchright-core Chromium version from browsers.json.
 * require.resolve('patchright-core') returns .../patchright-core/index.js
 * dirname() gives us the patchright-core/ directory directly (1 level up).
 */
export function getPatchrightChromiumVersion(): string {
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
  const isArm = os.arch() === 'arm64' || os.arch() === 'arm';
  // The OS token comes from the real runtime (platform + arch). Chrome on
  // Apple Silicon still reports the Intel macOS token, so macOS keeps it;
  // Windows/Linux report the real arch (x64 vs ARM64/aarch64). A hard-coded
  // 'x86_64' would be a lie on arm64.
  const osString = isMac
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : isWin
    ? (isArm ? 'Windows NT 10.0; Win64; ARM64' : 'Windows NT 10.0; Win64; x64')
    : (isArm ? 'X11; Linux aarch64' : 'X11; Linux x86_64');

  const chromiumVersion = getPatchrightChromiumVersion() || '149.0.7827.55';
  const generated = `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVersion} Safari/537.36`;

  if (uaOverridePool && uaOverridePool.length > 0) {
    const ua = uaOverridePool[uaRotationIndex % uaOverridePool.length];
    uaRotationIndex++;
    return ua;
  }

  return generated;
}

/**
 * --- Fingerprint coherence: every value derives from the real runtime ---
 * A fingerprint is only consistent when each value agrees with the machine
 * the browser actually runs on. Nothing here is hard-coded to one device:
 * the OS, arch, kernel, Chromium version and the egress IP's geo are all
 * read from the live environment, on every platform. The browser reports
 * its TRUE values; the only alignment applied is timezone/locale, which
 * must match the network the browser exits from (a browser claiming UTC
 * while its IP geolocates elsewhere is flagged "Timezone spoofed").
 */

const COUNTRY_LOCALE: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR', JP: 'ja-JP', IN: 'en-IN',
  AU: 'en-AU', CA: 'en-CA', ES: 'es-ES', IT: 'it-IT', NL: 'nl-NL', BR: 'pt-BR',
  MX: 'es-MX', KR: 'ko-KR', CN: 'zh-CN', RU: 'ru-RU', PL: 'pl-PL', SE: 'sv-SE',
  NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI', PT: 'pt-PT', TR: 'tr-TR', AE: 'ar-AE',
  SA: 'ar-SA', IL: 'he-IL', ZA: 'en-ZA', NZ: 'en-NZ', IE: 'en-IE', CH: 'de-CH',
  AT: 'de-AT', BE: 'nl-BE', CZ: 'cs-CZ', HU: 'hu-HU', GR: 'el-GR', UA: 'uk-UA',
};

type RuntimeGeo = { timezone: string; countryCode: string; lat: number; lon: number };
let cachedGeo: RuntimeGeo | null | undefined;
let geoInFlight: Promise<RuntimeGeo | null> | null = null;

function fetchJsonViaHttpProxy(url: string, proxy: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (proxy.username && proxy.password) {
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
    }
    const req = http.request(
      { host: String(proxy.host), port: Number(proxy.port), method: 'GET', path: url, headers, timeout: 8000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('geo lookup via proxy timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Resolve the egress IP's geolocation so the browser's timezone/locale
 * match the network it actually exits from. Best-effort: any failure
 * returns null and the caller keeps the host defaults — a failed lookup
 * must never fail connect(). Result is cached per process. The 8s bound
 * is a failure guard for a hung endpoint, not a wait for work to finish.
 */
async function resolveRuntimeGeo(proxy: Record<string, unknown>): Promise<RuntimeGeo | null> {
  if (cachedGeo !== undefined) return cachedGeo;
  if (geoInFlight) return geoInFlight;
  geoInFlight = (async (): Promise<RuntimeGeo | null> => {
    try {
      const fields = 'status,timezone,countryCode,lat,lon';
      const endpoint = `http://ip-api.com/json/?fields=${fields}`;
      let data: any = null;
      if (proxy && proxy.host && proxy.port) {
        // Same proxy the browser will use, so the geo is the exit IP the
        // sites will actually see (not this machine's own IP).
        data = await fetchJsonViaHttpProxy(endpoint, proxy);
      } else {
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        data = await res.json();
      }
      if (data && data.status === 'success' && typeof data.timezone === 'string' && data.timezone) {
        cachedGeo = {
          timezone: data.timezone,
          countryCode: typeof data.countryCode === 'string' ? data.countryCode : '',
          lat: typeof data.lat === 'number' ? data.lat : 0,
          lon: typeof data.lon === 'number' ? data.lon : 0,
        };
        return cachedGeo;
      }
      cachedGeo = null;
      return null;
    } catch {
      cachedGeo = null;
      return null;
    }
  })();
  return geoInFlight;
}

/**
 * Derive the client-hints platformVersion from the real OS. Chrome reports
 * the kernel version on Linux, the macOS version on macOS (Darwin major - 9),
 * and 15.0.0 on Windows 11 / 10.0.0 on Windows 10. A hard-coded version
 * (e.g. '6.6.0') is a lie on every other kernel/build.
 */
export function derivePlatformVersion(platformName: string): string {
  const rel = os.release() || '';
  if (platformName === 'Linux') {
    const m = rel.match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '6.6.0';
  }
  if (platformName === 'macOS') {
    const major = parseInt(rel.split('.')[0], 10);
    if (!Number.isNaN(major) && major >= 20) return `${major - 9}.0.0`;
    if (major === 19) return '10.15.0';
    return '14.0.0';
  }
  // Windows: NT build >= 22000 is Windows 11 (Chrome reports 15.0.0).
  const m = rel.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (m) {
    if (parseInt(m[1], 10) === 10 && parseInt(m[3], 10) >= 22000) return '15.0.0';
    return `${m[1]}.0.0`;
  }
  return '15.0.0';
}

/** Derive the client-hints architecture/bitness from the real CPU. */
export function deriveArchitecture(): { architecture: string; bitness: string } {
  const arch = os.arch();
  if (arch === 'arm64') return { architecture: 'arm', bitness: '64' };
  if (arch === 'arm') return { architecture: 'arm', bitness: '32' };
  if (arch === 'ia32') return { architecture: 'x86', bitness: '32' };
  return { architecture: 'x86', bitness: '64' };
}

/**
 * True only on a GPU-less Linux host (Xvfb/CI). Headed Chromium there
 * creates NO WebGL context at all — a "Chrome" with no WebGL is itself a
 * fingerprint contradiction. The SwiftShader flags are applied only here;
 * real desktops (and macOS/Windows, which always have a GPU path) keep
 * hardware rendering.
 */
function needsSoftwareWebGL(): boolean {
  if (os.platform() !== 'linux') return false;
  try {
    return !fs.existsSync('/dev/dri/card0') && !fs.existsSync('/dev/dri/renderD128');
  } catch {
    return false;
  }
}

/**
 * Initialize the adblocker singleton entirely in memory (no disk cache).
 * On failure, reset adBlockerPromise to null so the next call can retry
 * instead of being permanently stuck with a resolved-null promise.
 */
function getAdBlocker(): Promise<PlaywrightBlocker | null> {
  if (!adBlockerPromise) {
    adBlockerPromise = (async (): Promise<PlaywrightBlocker | null> => {
      try {
        const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
        adBlockerInstance = blocker;
        return blocker;
      } catch (err: any) {
        console.error('[adblocker] Failed to initialize adblocker (blocking disabled):', err?.message || err);
        // Reset so the next connect() call can retry
        adBlockerPromise = null;
        return null;
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

  const cursorPromise = Promise.resolve(createCursor(page)).catch(() => null);

  // Preserve original Playwright native methods
  const origClick = page.click ? page.click.bind(page) : async () => {};
  const origHover = page.hover ? page.hover.bind(page) : async () => {};
  const origType = page.type ? page.type.bind(page) : async () => {};
  const origGoto = page.goto ? page.goto.bind(page) : async () => {};

  // 1. Transparent Auto-Human page.click
  (page as any).click = async (selector: string, options: any = {}) => {
    if (options?.noHuman === true || options?.force === true) {
      return origClick(selector, options);
    }
    try {
      const cursor = await cursorPromise;
      if (cursor && (cursor as any).actions) {
        const delay = options?.delay ?? (35 + Math.floor(Math.random() * 60));
        await (cursor as any).actions.click({ target: selector, delay, ...options });
        return;
      }
    } catch (_) {}
    return origClick(selector, options);
  };

  // 2. Transparent Auto-Human page.hover
  (page as any).hover = async (selector: string, options: any = {}) => {
    if (options?.noHuman === true) {
      return origHover(selector, options);
    }
    try {
      const cursor = await cursorPromise;
      if (cursor && (cursor as any).actions) {
        await (cursor as any).actions.move(selector, options);
        return;
      }
    } catch (_) {}
    return origHover(selector, options);
  };

  // 3. Transparent Auto-Human page.type
  (page as any).type = async (selector: string, text: string, options: any = {}) => {
    if (options?.noHuman === true) {
      return origType(selector, text, options);
    }
    try {
      await (page as any).click(selector, { ...options, noHuman: false });
    } catch (_) {}
    for (const char of text) {
      const keyDelay = options?.delay ?? (35 + Math.floor(Math.random() * 65));
      await page.keyboard.press(char, { delay: keyDelay });
    }
  };

  // 4. Transparent Auto-WAF page.goto
  (page as any).goto = async (url: string, options: any = {}) => {
    const response = await origGoto(url, { waitUntil: 'domcontentloaded', ...options });
    if (options?.autoWafWait !== false && !page.isClosed()) {
      try {
        const isChallenge = await page.evaluate(() => {
          const title = (document.title || '').toLowerCase();
          return title.includes('just a moment') ||
                 title.includes('attention required') ||
                 document.querySelector('#challenge-stage') !== null ||
                 document.querySelector('.cf-turnstile') !== null;
        }).catch(() => false);

        if (isChallenge) {
          const startWait = Date.now();
          while (!page.isClosed() && (Date.now() - startWait) < 20000) {
            await new Promise(r => setTimeout(r, 1000));
            const stillChallenge = await page.evaluate(() => {
              const title = (document.title || '').toLowerCase();
              return title.includes('just a moment') ||
                     title.includes('attention required') ||
                     document.querySelector('#challenge-stage') !== null;
            }).catch(() => false);
            if (!stillChallenge) break;
          }
        }
      } catch (_) {}
    }
    return response;
  };

  // Backward compatibility: keep realClick and realCursor explicitly mapped
  page.realClick = async (selector: string, options: Record<string, unknown> = {}) => {
    return page.click(selector, options);
  };

  page.realCursor = {
    move: async (selector: string, options: Record<string, unknown> = {}) => {
      return page.hover(selector, options);
    }
  };

  return page;
}

export async function applyUserAgentOverride(page: Page, userAgent: string, userAgentMetadata: any): Promise<void> {
  try {
    if (page.isClosed()) return;
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

/**
 * Patchright (derived from Playwright) passes `--disable-features=...` by default,
 * which includes `ThirdPartyStoragePartitioning`.
 * Real browsers have third-party storage partitioning enabled by default; disabling it
 * is an immediate automation tell detected by bot detectors like Rebrowser.
 * We extract Patchright's default disabledFeatures list and remove
 * `ThirdPartyStoragePartitioning` so storage partitioning remains active as in real Chrome.
 */
const DEFAULT_PATCHRIGHT_DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect',
  'AvoidCorsURLLoaderRestartOnRedirect',
  'Translate',
  'AutoDeElevate',
  'OptimizationHints',
  'NetworkTimeServiceQuerying',
  'AimEnabled',
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion'
];

let cachedDisabledFeatures: string[] | null = null;

function getPatchrightDisabledFeatures(): string[] {
  if (cachedDisabledFeatures) return cachedDisabledFeatures;
  try {
    const coreDir = path.dirname(require.resolve('patchright-core'));
    const bundlePath = path.join(coreDir, 'lib', 'coreBundle.js');
    if (fs.existsSync(bundlePath)) {
      const content = fs.readFileSync(bundlePath, 'utf8');
      const match = content.match(/disabledFeatures\s*=\s*\[([\s\S]*?)\]\.filter/);
      if (match) {
        const strings = Array.from(match[1].matchAll(/"([^"]+)"|'([^']+)'/g)).map(m => m[1] || m[2]);
        const filtered = strings.filter(f => f && f !== 'MediaRouter');
        if (filtered.length > 0) {
          cachedDisabledFeatures = filtered;
          return cachedDisabledFeatures;
        }
      }
    }
  } catch { /* ignore fallback */ }
  cachedDisabledFeatures = DEFAULT_PATCHRIGHT_DISABLED_FEATURES;
  return cachedDisabledFeatures;
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
    ignoreDefaultArgs = undefined as boolean | string[] | undefined,
  }: {
    args?: string[];
    headless?: boolean;
    proxy?: Record<string, unknown>;
    contextOptions?: Record<string, unknown>;
    turnstile?: boolean;
    enableBlocker?: boolean;
    executablePath?: string;
    ignoreDefaultArgs?: boolean | string[];
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

    // Start the egress-geo lookup now so it overlaps the browser launch
    // (resolveRuntimeGeo caches the in-flight promise; awaited below).
    const geoLookup = resolveRuntimeGeo(proxy);

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

    // Platform version + architecture: derived from the real OS/CPU, never
    // hard-coded (see derivePlatformVersion / deriveArchitecture).
    const platformVersion = derivePlatformVersion(platformName);
    const { architecture, bitness } = deriveArchitecture();

    const userAgentMetadata: Record<string, unknown> = {
      brands,
      fullVersionList,
      fullVersion: chromeVersion,
      mobile: false,
      platform: platformName,
      platformVersion,
      architecture,
      model: '',
      bitness,
      wow64: false
    };

    const defaultDisabled = getPatchrightDisabledFeatures();
    const exactPatchrightDisableArg = '--disable-features=' + defaultDisabled.join(',');
    const sanitizedDisableArg = '--disable-features=' + defaultDisabled.filter(f => f !== 'ThirdPartyStoragePartitioning').join(',');

    const launchIgnoreDefaultArgs: boolean | string[] = ignoreDefaultArgs === true
      ? true
      : [
          ...(Array.isArray(ignoreDefaultArgs) ? ignoreDefaultArgs : []),
          exactPatchrightDisableArg
        ];

    const chromiumArgs = [
      `--user-agent=${ua}`,
      '--disable-blink-features=AutomationControlled',
      sanitizedDisableArg,
      // FIX: only disable the Chromium sandbox when required (CI, containers,
      // root). On normal desktops the OS-level sandbox stays enabled — it is a
      // strong security boundary for untrusted page content.
      ...(shouldDisableChromiumSandbox() ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      // FIX: removed --window-size — it caused browser to open maximized/fullscreen.
      // Browser window size is controlled by the OS/user, not forced by the server.
      '--disable-dev-shm-usage',
      // Coherence: on a GPU-less Linux host (Xvfb/CI) headed Chromium creates
      // NO WebGL context without a software GL backend. Force SwiftShader
      // there so WebGL exists and matches headless behaviour; real desktops
      // keep hardware rendering (see needsSoftwareWebGL).
      ...(needsSoftwareWebGL() ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
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
      ignoreDefaultArgs: launchIgnoreDefaultArgs,
      proxy: playwrightProxy as any,
      ...(executablePath ? { executablePath } : {}),
    });

    // FIX: await adblocker init BEFORE creating the page so enableBlockingInPage
    // is called synchronously on adBlockerInstance (fast path), not via a
    // fire-and-forget then() that may lose the race with first navigation.
    if (enableBlocker) {
      await getAdBlocker();
    }

    // Align the browser's timezone/locale with the egress IP's geo (the
    // network the browser actually exits from). A browser claiming UTC while
    // its IP geolocates elsewhere is flagged "Timezone spoofed". Explicit
    // caller options always win; a failed lookup keeps host defaults.
    const runtimeGeo = await geoLookup;
    const geoContextOptions: Record<string, unknown> = {};
    if (runtimeGeo) {
      if (contextOptions.timezoneId === undefined) geoContextOptions.timezoneId = runtimeGeo.timezone;
      if (contextOptions.locale === undefined) geoContextOptions.locale = COUNTRY_LOCALE[runtimeGeo.countryCode] || 'en-US';
      if (contextOptions.geolocation === undefined) geoContextOptions.geolocation = { latitude: runtimeGeo.lat, longitude: runtimeGeo.lon };
    }

    const context = await browser.newContext({
      viewport: null,
      ...geoContextOptions,
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
      try {
        if (newPage.isClosed()) return;
        await applyUserAgentOverride(newPage, ua, userAgentMetadata as any);
        if (newPage.isClosed()) return;
        setupRealPage(newPage);
        if (enableBlocker) await enableBlockingInPage(newPage);
        if (newPage.isClosed()) return;
        await pageController({
          browser,
          page: newPage,
          proxy,
          turnstile,
        });
      } catch (_) {
        // Page might have already closed
      }
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
