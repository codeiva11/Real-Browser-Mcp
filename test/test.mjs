import test from 'node:test';
import assert from 'node:assert';

const type = process.argv.includes('--esm') ? 'esm' : 'cjs';
const libPath = type === 'esm' ? '../dist/lib/esm/index.mjs' : '../dist/src/index.js';
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

test('Headless Detection Test', async () => {
    await warmUp();
    // headless-detector.vercel.app — समर्पित headless/automation detector
    // score 0.0 (normal browser) से 1.0 (definitely headless); WebDriver, CDP artifacts,
    // Worker UA, Emoji OS (2026 tests) जांचता है। Pixelscan से पूरी तरह अलग।
    await goto("https://headless-detector.vercel.app/");
    await new Promise(r => setTimeout(r, 3500));
    const detection = await page.evaluate(() => {
        const scoreEl = document.querySelector('#score');
        const bodyText = document.body.innerText;
        const webdriverPresent = /WebDriver Present\s*YES/i.test(bodyText);
        const cdpDetected = /CDP Artifacts Detected\s*YES/i.test(bodyText);
        return {
            score: scoreEl ? parseFloat(scoreEl.textContent.trim()) : null,
            webdriverPresent,
            cdpDetected,
        };
    });
    assert.ok(detection.score !== null && !Number.isNaN(detection.score), "Headless Detection test: could not read detection score from page");
    // score 0.5 से कम = normal browser; WebDriver और CDP artifacts नहीं मिलने चाहिए
    assert.strictEqual(detection.webdriverPresent, false, "Headless Detection test failed! WebDriver detected.");
    assert.strictEqual(detection.cdpDetected, false, "Headless Detection test failed! CDP artifacts detected.");
    assert.strictEqual(detection.score < 0.5, true, `Headless Detection test failed! Score ${detection.score} indicates headless browser (>= 0.5).`);
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
    while (!verify && (Date.now() - startDate) < 90000) {
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
    await page.waitForSelector('.cf-turnstile');
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

test('Fingerprint JS Bot Detector', async () => {
    await goto("https://fingerprint.com/products/bot-detection/");
    await new Promise(r => setTimeout(r, 5000));
    const detect = await page.evaluate(() => {
        return document.body.innerText.toLowerCase().includes("not")
    })
    assert.strictEqual(detect, true, "Fingerprint JS Bot Detector test failed!")
})

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
    await new Promise(r => setTimeout(r, 5000));

    const score = await page.evaluate(() => {
        return document.querySelector('big').textContent.replace(/[^0-9.]/g, '')
    })
    // 0.3+ means browser is not obviously a bot. Higher scores depend on IP reputation.
    assert.strictEqual(Number(score) >= 0.9, true, "(please first check if you can access https://antcpt.com/score_detector/.) Recaptcha V3 Score should be >=0.9 (not obviously a bot). Score Result: " + score)
})

test('Pixelscan Fingerprint Check', async () => {
    let result = false;
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        await warmUp();
        await goto("https://pixelscan.net/fingerprint-check");
        const startTime = Date.now();
        while (!result && (Date.now() - startTime) < 30000) {
            result = await page.evaluate(() => {
                const statusBar = document.querySelector('.status-content');
                if (!statusBar) return false;
                const statusText = statusBar.innerText.toLowerCase();
                const isConsistent = statusText.includes('consistent') && !statusText.includes('inconsistent');
                const cards = Array.from(document.querySelectorAll('.checker-card'));
                if (cards.length === 0) return false;
                const isScanning = cards.some(c => c.innerText.toLowerCase().includes('scanning') || c.innerText.toLowerCase().includes('collecting'));
                if (isScanning) return false;
                const fingerprintCard = cards.find(c => c.innerText.toLowerCase().includes('fingerprint'));
                if (!fingerprintCard) return false;
                const hasMasking = fingerprintCard.innerText.toLowerCase().includes('masking detected') && !fingerprintCard.innerText.toLowerCase().includes('no masking');
                return isConsistent && !hasMasking;
            }).catch(() => false);
            if (!result) await new Promise(r => setTimeout(r, 1000));
        }
    }
    await new Promise(r => setTimeout(r, 10000));
    assert.strictEqual(result, true, "Pixelscan Fingerprint Check failed after 2 attempts!");

})
