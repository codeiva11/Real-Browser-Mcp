import test from 'node:test';
import assert from 'node:assert';

const type = process.argv.includes('--esm') ? 'esm' : 'cjs';
const libPath = type === 'esm' ? '../lib/esm/index.mjs' : '../dist/lib/cjs/index.js';
const { connect } = await import(libPath);

console.log(`🧪 Running ${type.toUpperCase()} Tests`);
const realBrowserOption = {
    turnstile: true,
    headless: false,
    customConfig: {}
};

let browser = null;
let page = null;

const goto = async (url, options = {}) => {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...options });
    } catch {
        await page.goto('about:blank').catch(() => { });
        await new Promise(r => setTimeout(r, 1000));
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...options });
    }
};

const warmUp = async () => {
    await goto('about:blank');
};

// Delay settings (default 0 means AUTO smart delay based on test speed/result)
// To force a fixed delay (in ms), change this value or pass INSPECT_DELAY_MS in terminal:
const MANUAL_DELAY_MS = Number(process.env.INSPECT_DELAY_MS) || 0;

let testStartTime = 0;

// Setup - Run once before all tests
test.before(async () => {
    console.log('🚀 Starting browser for all tests...');
    const result = await connect(realBrowserOption);
    browser = result.browser;
    page = result.page;
    console.log('✅ Browser started successfully');
});

test.beforeEach(async (t) => {
    testStartTime = Date.now();
    const testName = t?.name || 'test';
    console.log(`\n▶️ [RUNNING]: ${testName}`);
});

test.afterEach(async (t) => {
    const testName = t?.name || 'test';
    const durationMs = Date.now() - testStartTime;
    const isPassed = t.passed !== false;

    // Automatic Smart Delay:
    // - Fast tests (<20s): hold 4s so user has ample time to see results
    // - Long tests (>=20s, e.g. Cloudflare): hold 2.5s (user was already watching the solve)
    // - Failed tests: hold 8s so user can diagnose what failed on page
    let delayMs = MANUAL_DELAY_MS;
    if (delayMs === 0) {
        if (!isPassed) {
            delayMs = 8000;
        } else if (durationMs >= 20000) {
            delayMs = 2500;
        } else {
            delayMs = 4000;
        }
    }

    // Inject visual status banner directly onto the browser page
    if (page && !page.isClosed()) {
        await page.evaluate(({ name, passed, durationSec, nextDelaySec }) => {
            const existing = document.getElementById('__test_status_banner__');
            if (existing) existing.remove();

            const banner = document.createElement('div');
            banner.id = '__test_status_banner__';
            banner.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 2147483647;
                background: ${passed ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #dc2626, #ef4444)'};
                color: #ffffff;
                padding: 12px 18px;
                border-radius: 10px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.35);
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 15px;
                font-weight: 600;
                line-height: 1.4;
                pointer-events: none;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;

            banner.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size: 18px;">${passed ? '✅' : '❌'}</span>
                    <span>${passed ? 'PASSED' : 'FAILED'}: ${name}</span>
                </div>
                <div style="font-size: 12px; opacity: 0.95; font-weight: 400;">
                    Duration: ${durationSec}s | Next test in: ${nextDelaySec}s...
                </div>
            `;
            document.body?.appendChild(banner);
        }, {
            name: testName,
            passed: isPassed,
            durationSec: (durationMs / 1000).toFixed(1),
            nextDelaySec: (delayMs / 1000).toFixed(1)
        }).catch(() => {});
    }

    console.log(`⏸️ [${isPassed ? 'PASSED' : 'FAILED'}]: "${testName}" (${(durationMs / 1000).toFixed(1)}s). Holding screen for ${(delayMs / 1000).toFixed(1)}s...`);
    await new Promise(r => setTimeout(r, delayMs));
});

// Teardown - Run once after all tests
test.after(async () => {
    const finalWait = MANUAL_DELAY_MS || 4000;
    console.log(`\n🏁 All tests finished! Waiting ${finalWait / 1000}s before closing browser...`);
    await new Promise(r => setTimeout(r, finalWait));
    if (browser) {
        await browser.close();
        console.log('✅ Browser closed successfully');
    }
});

test('Rebrowser Bot Detector', async () => {
    await warmUp();
    // Wait for 'load': the detector runs its checks (incl. popupBlocking) at
    // window.onload. The page.evaluate() calls below grant transient user
    // activation (Playwright passes userGesture: true), so the onload tests
    // must already have run before the first evaluate, or the popup test
    // sees a user-initiated popup. (The lib's own goto probes no longer
    // grant activation — they use a raw CDP evaluate — but the test's own
    // reads still do, so the load wait stays necessary.)
    await page.goto("https://bot-detector.rebrowser.net/", { waitUntil: 'load', timeout: 30000 });
    await new Promise(r => setTimeout(r, 100));
    const client = await page.context().newCDPSession(page);
    await client.send('Runtime.evaluate', { expression: 'window.dummyFn()' }).catch(() => { });
    await client.send('Runtime.evaluate', { expression: "window.exposedFn = () => { console.log('exposedFn call') }" }).catch(() => { });
    await client.send('Runtime.evaluate', { expression: "document.getElementById('detections-json')" }).catch(() => { });
    await page.evaluate(() => document.getElementsByClassName('div')).catch(() => { });
    await new Promise(r => setTimeout(r, 3000));
    const detections = await page.evaluate(() => {
        const el = document.querySelector('#detections-json');
        try { return JSON.parse(el?.value || ''); } catch { return null; }
    });
    assert.ok(detections !== null, "Rebrowser Bot Detector: Could not read detection JSON from page");
    const detected = detections.filter(d => d.rating === 1);
    if (detected.length > 0) {
        console.log('⚠️ Detected as bot for:', detected.map(d => d.type).join(', '));
    }
    assert.strictEqual(detected.length, 0, `Rebrowser Bot Detector failed! Detected: ${detected.map(d => d.type).join(', ')}`)
});

test('Sannysoft WebDriver Detector', async () => {
    await warmUp();
    await goto("https://bot.sannysoft.com/");
    await new Promise(r => setTimeout(r, 3000));
    let result = await page.evaluate(() => {
        const webdriverEl = document.getElementById('webdriver-result');
        return webdriverEl && webdriverEl.classList.contains('passed');
    });
    assert.strictEqual(result, true, "Sannysoft WebDriver Detector test failed! Browser detected as bot.")
});

test('Cloudflare WAF', async () => {
    await warmUp();
    await goto("https://nopecha.com/demo/cloudflare");
    let verify = null;
    let startDate = Date.now();
    while (!verify && (Date.now() - startDate) < 90000) {
        verify = await page.evaluate(() => {
            return document.querySelector('.link_row') || document.querySelector('a[href*="nopecha"]') ? true : null;
        }).catch(() => null);
        if (!verify) {
            const title = await page.title().catch(() => '');
            const url = page.url();
            const notChallenge = !title.toLowerCase().includes('just a moment') && !title.toLowerCase().includes('attention required');
            if (notChallenge && url.includes('nopecha.com/demo')) {
                verify = true;
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    assert.strictEqual(verify === true, true, "Cloudflare WAF test failed! (Site may be blocking automated access)");
});

test('Cloudflare Turnstile', async () => {
    await warmUp();
    await goto("https://2captcha.com/demo/cloudflare-turnstile");
    // Don't wait for selector, it can be inside an iframe or custom element
    await new Promise(r => setTimeout(r, 2000));
    let token = null;
    let startDate = Date.now();
    while (!token && (Date.now() - startDate) < 40000) {
        token = await page.evaluate(() => {
            try {
                let item = document.querySelector('[name="cf-turnstile-response"]')?.value;
                return item && item.length > 20 ? item : null;
            } catch (e) { return null; }
        });
        await new Promise(r => setTimeout(r, 1000));
    }
    assert.strictEqual(token !== null, true, "Cloudflare turnstile test failed!");
});

test('Recaptcha V3 Score', async () => {
    await warmUp();
    const targetUrl = 'https://antcpt.com/eng/information/demo-form/recaptcha-3-test-score.html';
    await page.goto(targetUrl, { waitUntil: 'load' }).catch(async () => {
        await page.goto('https://antcpt.com/score_detector/', { waitUntil: 'load' });
    });

    // Human-like warm-up interactions before checking
    if (page.realCursor) {
        await page.realCursor.move('body', { paddingPercentage: 20 }).catch(() => { });
    }
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    await page.mouse.wheel(0, 100 + Math.random() * 100).catch(() => { });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    // Wait for score to appear (event-driven polling up to 35s)
    let score = null;
    const startTime = Date.now();
    let clicked = false;
    while ((Date.now() - startTime) < 35000) {
        const text = await page.evaluate(() => {
            const el = document.querySelector('#score') || document.querySelector('big');
            return el ? el.innerText || el.textContent : '';
        }).catch(() => '');
        if (text && (text.includes('0.') || text.includes('1.') || text.includes('Your score is:'))) {
            const match = text.match(/\b([0-1]\.\d+)\b/);
            if (match) {
                score = match[1];
                break;
            }
        }
        if (!clicked && (Date.now() - startTime) > 8000) {
            clicked = true;
            const btn = await page.$('button').catch(() => null);
            if (btn) await btn.click().catch(() => { });
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    assert.ok(score !== null, "Recaptcha V3 Score: Failed to retrieve score within 35s");
    assert.strictEqual(Number(score) >= 0.7, true, "Recaptcha V3 Score should be >=0.7 (not obviously a bot). Score Result: " + score);
});

test('Pixelscan Fingerprint Check', async () => {
    let result = false;
    let failReason = '';
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
            await warmUp();
            await goto("https://pixelscan.net/fingerprint-check");

            // Natural user interactions for Pixelscan behavioral metrics
            if (page.realCursor) {
                await page.realCursor.move('body', { paddingPercentage: 30 }).catch(() => { });
            }
            await page.mouse.wheel(0, 150).catch(() => { });

            // Wait until the scan actually finishes (event-driven): poll for a
            // verdict instead of a fixed window. On slow networks the scan is
            // still 'Collecting Data...' at 35s and only finishes around 90s,
            // so the old 30s window failed before any verdict existed.
            // The 300s bound is only a hang guard for a dead page, not a
            // verdict window: the loop exits the moment a verdict appears.
            const startTime = Date.now();
            while (Date.now() - startTime < 300000) {
                const verdict = await page.evaluate(() => {
                    const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
                    const statusBar = document.querySelector('.status-content, .result-status, .status-banner, [class*="status-"]');
                    const statusText = (statusBar ? statusBar.innerText : bodyText).toLowerCase();

                    // Negative verdict first: 'inconsistent' contains
                    // 'consistent' as a substring, so it must be checked first.
                    if (statusText.includes('inconsistent') || statusText.includes('bot detected') || statusText.includes('automation detected')) {
                        return { state: 'fail', reason: statusText.slice(0, 120) };
                    }

                    const cards = Array.from(document.querySelectorAll('.checker-card, [class*="card"]'));
                    const isScanning = cards.some(c => { const t = c.innerText.toLowerCase(); return t.includes('scanning') || t.includes('collecting') || t.includes('evaluating'); });
                    if (isScanning && cards.length > 0) return { state: 'scanning' };

                    const isConsistent = statusText.includes('consistent') || statusText.includes('no automated framework') || statusText.includes('clean') || bodyText.includes('no automated framework detected');
                    const fingerprintCard = cards.find(c => c.innerText.toLowerCase().includes('fingerprint'));
                    const hasMasking = fingerprintCard ? (fingerprintCard.innerText.toLowerCase().includes('masking detected') && !fingerprintCard.innerText.toLowerCase().includes('no masking')) : false;
                    if (hasMasking) return { state: 'fail', reason: 'fingerprint masking detected' };
                    if (isConsistent) return { state: 'pass' };

                    // Scan finished but no verdict text yet - keep waiting.
                    return { state: 'scanning' };
                }).catch(() => ({ state: 'scanning' }));

                if (verdict.state === 'pass') { result = true; break; }
                if (verdict.state === 'fail') { failReason = verdict.reason || ''; break; }
                await new Promise(r => setTimeout(r, 3000));
            }
            if (!result && !failReason) failReason = 'scan did not finish (hang guard reached)';
        } catch (err) {
            failReason = err.message;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    assert.strictEqual(result, true, `Pixelscan Fingerprint Check failed after 2 attempts! ${failReason}`);
});


test('Pixelscan Bot Check', async () => {
    let result = false;
    let failReason = '';
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
            await warmUp();
            await goto("https://pixelscan.net/bot-check");

            // Natural user interactions for Pixelscan behavioral metrics
            if (page.realCursor) {
                await page.realCursor.move('body', { paddingPercentage: 25 }).catch(() => { });
            }
            await page.mouse.wheel(0, 120).catch(() => { });

            // Event-driven wait for the verdict (see Fingerprint Check above).
            const startTime = Date.now();
            while (Date.now() - startTime < 300000) {
                const verdict = await page.evaluate(() => {
                    // Check active state header on Pixelscan (active state has opacity === '1')
                    const activeHeaderState = Array.from(document.querySelectorAll('.checker-header > div')).find(el => {
                        return window.getComputedStyle(el).opacity === '1';
                    });

                    if (activeHeaderState) {
                        const text = activeHeaderState.innerText.toLowerCase();
                        // Negative verdict first: 'inconsistent' contains
                        // 'consistent' as a substring, so checking 'consistent'
                        // first would pass an 'inconsistent' verdict.
                        if (text.includes('bot') || text.includes('error') || text.includes('inconsistent')) {
                            return { state: 'fail', reason: text.slice(0, 120) };
                        }
                        if (text.includes('human') || text.includes('consistent') || text.includes('clean')) {
                            return { state: 'pass' };
                        }
                    }

                    // Check for explicit failed bot check section
                    const failedSection = document.querySelector('.failed-bot-check');
                    if (failedSection && window.getComputedStyle(failedSection).display !== 'none') {
                        return { state: 'fail', reason: 'failed-bot-check section visible' };
                    }

                    // Fallback check for visible result status element
                    const statusBar = document.querySelector('.status-content, .result-status, .status-banner');
                    if (statusBar) {
                        const statusText = statusBar.innerText.toLowerCase();
                        if (statusText.includes('inconsistent') || statusText.includes('automation detected') || statusText.includes('bot detected')) {
                            return { state: 'fail', reason: statusText.slice(0, 120) };
                        }
                        if (statusText.includes('consistent') || statusText.includes('no automated framework') || statusText.includes('clean')) {
                            return { state: 'pass' };
                        }
                    }

                    const cards = Array.from(document.querySelectorAll('.checker-card, [class*="card"]'));
                    const isScanning = cards.some(c => {
                        const txt = c.innerText.toLowerCase();
                        return txt.includes('scanning') || txt.includes('collecting') || txt.includes('evaluating') || txt.includes('running');
                    });
                    if (isScanning && cards.length > 0) return { state: 'scanning' };

                    return { state: 'scanning' };
                }).catch(() => ({ state: 'scanning' }));

                if (verdict.state === 'pass') { result = true; break; }
                if (verdict.state === 'fail') { failReason = verdict.reason || ''; break; }
                await new Promise(r => setTimeout(r, 3000));
            }
            if (!result && !failReason) failReason = 'scan did not finish (hang guard reached)';
        } catch (err) {
            failReason = err.message;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    assert.strictEqual(result, true, `Pixelscan Bot Check failed! ${failReason}`);
});
