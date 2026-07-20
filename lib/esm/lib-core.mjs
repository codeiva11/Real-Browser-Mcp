"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
})(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHeadlessFromEnv = void 0;
export { getDefaultHeadless };
export { setupRealPage };
export { applyUserAgentOverride };
export { createConnect };
import * as patchright_1 from 'patchright';
import * as ghost_cursor_patchright_1 from 'ghost-cursor-patchright';
import * as adblocker_playwright_1 from '@ghostery/adblocker-playwright';
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
import * as env_utils_1 from './env-utils.mjs';
Object.defineProperty(exports, "getHeadlessFromEnv", { enumerable: true, get: function () { return env_utils_1.getHeadlessFromEnv; } });
let adBlockerInstance = null;
let adBlockerPromise = null;
// Cache the detected user-agent string so we don't launch a temp browser on every connect()
let cachedNativeUa = null;
const UA_CACHE_FILE = path.join(process.cwd(), '.cache', 'ua-cache.txt');
function loadCachedUa() {
    try {
        if (fs.existsSync(UA_CACHE_FILE)) {
            const ua = fs.readFileSync(UA_CACHE_FILE, 'utf8').trim();
            if (ua && ua.includes('Chrome/'))
                return ua;
        }
    }
    catch { /* ignore */ }
    return null;
}
function saveCachedUa(ua) {
    try {
        const dir = path.dirname(UA_CACHE_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(UA_CACHE_FILE, ua, 'utf8');
    }
    catch { /* ignore */ }
}
async function getNativeUserAgent(executablePath) {
    // Return in-memory cache first
    if (cachedNativeUa)
        return cachedNativeUa;
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
        const tempBrowser = await patchright_1.chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            ...(executablePath ? { executablePath } ),
        });
        const tempContext = await tempBrowser.newContext();
        const tempPage = await tempContext.newPage();
        const ua = await tempPage.evaluate(() => navigator.userAgent);
        await tempBrowser.close();
        cachedNativeUa = ua;
        if (!executablePath)
            saveCachedUa(ua);
        return ua;
    }
    catch (e) {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36';
    }
}
function getAdBlocker() {
    if (!adBlockerPromise) {
        const cachePath = path.join(__dirname, 'adblocker.bin');
        adBlockerPromise = adblocker_playwright_1.PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
            path: cachePath,
            read: fs.promises.readFile,
            write: fs.promises.writeFile,
        }).then((blocker) => {
            adBlockerInstance = blocker;
            return blocker;
        }).catch((err) => {
            console.error('[adblocker] Failed to initialize adblocker:', err.message);
            return null;
        });
    }
    return adBlockerPromise;
}
function getDefaultHeadless() {
    return (0, env_utils_1.getHeadlessFromEnv)();
}
function setupRealPage(browser, page) {
    if (page._setupApplied)
        return page;
    page._setupApplied = true;
    if (adBlockerInstance) {
        adBlockerInstance.enableBlockingInPage(page).catch(() => { });
    }
    else {
        getAdBlocker().then((blocker) => {
            if (blocker) {
                blocker.enableBlockingInPage(page).catch(() => { });
            }
        });
    }
    page.realScroll = async (deltaY, duration = 600) => {
        try {
            const stepDelay = 15;
            const steps = Math.max(10, Math.floor(duration / stepDelay));
            const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
            let currentScroll = 0;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const targetScroll = deltaY * easeOutCubic(t);
                const diff = targetScroll - currentScroll;
                await page.mouse.wheel(0, diff);
                currentScroll = targetScroll;
                await new Promise(r => setTimeout(r, stepDelay));
            }
        }
        catch (e) {
            try {
                await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), deltaY);
            }
            catch (_) { }
        }
    };
    try {
        const cursor = (0, ghost_cursor_patchright_1.createCursor)(page);
        page.realCursor = {
            move: async (selector, options = {}) => {
                try {
                    await cursor.actions.move(selector, options);
                }
                catch (e) {
                    try {
                        await page.hover(selector);
                    }
                    catch (_) { }
                }
            }
        };
        page.realClick = async (selector, options = {}) => {
            try {
                await cursor.actions.click({ target: selector, ...options });
            }
            catch (e) {
                await page.click(selector, options);
            }
        };
    }
    catch (e) {
        if (!page.realClick) {
            page.realClick = async (selector, options) => {
                await page.click(selector, options);
            };
        }
        if (!page.realCursor) {
            page.realCursor = {
                move: async (selector) => {
                    try {
                        await page.hover(selector);
                    }
                    catch (_) { }
                }
            };
        }
    }
    return page;
}
async function applyUserAgentOverride(page, userAgent, userAgentMetadata) {
    try {
        const client = await page.context().newCDPSession(page);
        await client.send('Emulation.setUserAgentOverride', {
            userAgent,
            userAgentMetadata
        });
    }
    catch (e) {
        // Ignore errors
    }
}
function createConnect(pageController) {
    return async function connect({ args = [], headless = (0, env_utils_1.getHeadlessFromEnv)(), proxy = {}, contextOptions = {}, turnstile = false, executablePath = undefined, } = {}) {
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
        // Use cached UA — avoids launching an extra browser every time
        const nativeUa = await getNativeUserAgent(executablePath);
        let modifiedUa = nativeUa.replace(/HeadlessChrome\//g, 'Chrome/');
        const chromeVersionMatch = modifiedUa.match(/Chrome\/([\d.]+)/);
        const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '148.0.0.0';
        const majorVersion = chromeVersion.split('.')[0];
        const brands = [
            { brand: 'Google Chrome', version: majorVersion },
            { brand: 'Chromium', version: majorVersion },
            { brand: 'Not/A)Brand', version: '99' }
        ];
        let platformName = 'Windows';
        if (nativeUa.includes('Macintosh') || nativeUa.includes('Mac OS X')) {
            platformName = 'macOS';
        }
        else if (nativeUa.includes('Linux')) {
            platformName = 'Linux';
        }
        const fullVersionList = [
            { brand: 'Google Chrome', version: chromeVersion },
            { brand: 'Chromium', version: chromeVersion },
            { brand: 'Not/A)Brand', version: '99.0.0.0' }
        ];
        const userAgentMetadata = {
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
        let launchHeadless = headless;
        if (headless === true) {
            launchHeadless = false;
            if (!chromiumArgs.includes('--headless=new')) {
                chromiumArgs.push('--headless=new');
            }
        }
        const browser = await patchright_1.chromium.launch({
            headless: launchHeadless,
            args: chromiumArgs,
            proxy: playwrightProxy,
            ...(executablePath ? { executablePath } ),
        });
        await getAdBlocker();
        const context = await browser.newContext({
            viewport,
            ...contextOptions,
        });
        let page = await context.newPage();
        await applyUserAgentOverride(page, modifiedUa, userAgentMetadata);
        setupRealPage(browser, page);
        page = await pageController({
            browser,
            page,
            proxy,
            turnstile,
        });
        context.on('page', async (newPage) => {
            await applyUserAgentOverride(newPage, modifiedUa, userAgentMetadata);
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
            setupPage: async (p) => {
                await applyUserAgentOverride(p, modifiedUa, userAgentMetadata);
                setupRealPage(browser, p);
            }
        };
    };
}
//# sourceMappingURL=lib-core.js.map