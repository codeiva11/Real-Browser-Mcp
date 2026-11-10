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

const goto = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
};

const warmUp = async () => {
    await goto('about:blank');
};

// Setup - Run once before all tests
test.before(async () => {
    console.log('🚀 Starting browser for all tests...');
    const result = await connect(realBrowserOption);
    browser = result.browser;
    page = result.page;
    console.log('✅ Browser started successfully');
});

// Teardown - Run once after all tests
test.after(async () => {
    console.log('🏁 Closing browser after all tests...');
    if (browser) {
        await browser.close();
        console.log('✅ Browser closed successfully');
    }
});

test('Rebrowser Bot Detector', async () => {
    await warmUp();
    await goto("https://bot-detector.rebrowser.net/");
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
    // WAF test might take up to 30-40 seconds sometimes depending on network
    while (!verify && (Date.now() - startDate) < 60000) {
        verify = await page.evaluate(() => {
            return document.querySelector('.link_row') || document.querySelector('a[href*="nopecha"]') ? true : null;
        }).catch(() => null);
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
  //  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
 //   await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://antcpt.com/score_detector/");

    // Human-like warm-up interactions before clicking
    // 1. Random mouse movements using realCursor (Bézier curves via ghost-cursor)
    await page.realCursor.move('body', { paddingPercentage: 20 });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    // 2. Scroll down a bit to simulate reading
    await page.mouse.wheel(0, 100 + Math.random() * 100);
    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));

    // 3. Move mouse towards button area naturally
    await page.realCursor.move('button', { paddingPercentage: 10 });
    await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

    // 4. Now click the button
    await page.realClick("button")
    await new Promise(r => setTimeout(r, 6000));

    const score = await page.evaluate(() => {
        return document.querySelector('big').textContent.replace(/[^0-9.]/g, '')
    })
    // 0.3+ means browser is not obviously a bot. Higher scores depend on IP reputation.
    assert.strictEqual(Number(score) >= 0.9, true, "(please first check if you can access https://antcpt.com/score_detector/.) Recaptcha V3 Score should be >=0.9 (not obviously a bot). Score Result: " + score)
})

test('Pixelscan Fingerprint Check', async () => {
    let result = false;
    let failReason = '';
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        await warmUp();
        await goto("https://pixelscan.net/fingerprint-check");

        // Natural user interactions for Pixelscan behavioral metrics
        if (page.realCursor) {
            await page.realCursor.move('body', { paddingPercentage: 30 }).catch(() => {});
        }
        await page.mouse.wheel(0, 150).catch(() => {});

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
    }
    assert.strictEqual(result, true, `Pixelscan Fingerprint Check failed after 2 attempts! ${failReason}`);
});


test('Pixelscan Bot Check', async () => {
    let result = false;
    let failReason = '';
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        await warmUp();
        await goto("https://pixelscan.net/bot-check");

        // Natural user interactions for Pixelscan behavioral metrics
        if (page.realCursor) {
            await page.realCursor.move('body', { paddingPercentage: 25 }).catch(() => {});
        }
        await page.mouse.wheel(0, 120).catch(() => {});

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
    }
    assert.strictEqual(result, true, `Pixelscan Bot Check failed! ${failReason}`);
});
