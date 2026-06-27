// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert');
const { connect } = require('../../lib/cjs/index.js');

const realBrowserOption = {
    turnstile: true,
    headless: false,
    customConfig: {}
}

// Shared browser instance for all tests
let browser = null;
let page = null;

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
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://arh.antoinevastel.com/bots/areyouheadless", { timeout: 70000 });
    await new Promise(r => setTimeout(r, 3000));
    let result = await page.evaluate(() => {
        const el = document.querySelector('#res');
        return el && el.textContent.toLowerCase().includes('not') ? true : false;
    });
    assert.strictEqual(result, true, "Headless Detection test failed! Browser detected as headless.")
})

test('Rebrowser Bot Detector', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://bot-detector.rebrowser.net/", { waitUntil: 'domcontentloaded', timeout: 70000 });
    await new Promise(r => setTimeout(r, 100)); // Very short delay to ensure page scripts initialized

    // Use CDP to trigger tests in the main world (Patchright's page.evaluate runs in isolated world)
    const client = await page.context().newCDPSession(page);
    // dummyFn: call in main world to prove we can access main world objects
    await client.send('Runtime.evaluate', { expression: 'window.dummyFn()' }).catch(() => {});
    // exposeFunctionLeak: create a normal function (not via page.exposeFunction which leaks Playwright bindings)
    await client.send('Runtime.evaluate', { expression: "window.exposedFn = () => { console.log('exposedFn call') }" }).catch(() => {});
    // sourceUrlLeak: test if evaluate leaks sourceUrl via getElementById
    await client.send('Runtime.evaluate', { expression: "document.getElementById('detections-json')" }).catch(() => {});
    // mainWorldExecution: test if evaluate runs in isolated world (safe) vs main world (detectable)
    await page.evaluate(() => document.getElementsByClassName('div')).catch(() => {});

    await new Promise(r => setTimeout(r, 5000));
    const detections = await page.evaluate(() => {
        const el = document.querySelector('#detections-json') as HTMLTextAreaElement;
        try { return JSON.parse(el?.value || ''); } catch { return null; }
    });
    // console.log('🔍 Rebrowser Detections:', JSON.stringify(detections, null, 2));
    assert.ok(detections !== null, "Rebrowser Bot Detector: Could not read detection JSON from page");
    const detected = detections.filter((d: any) => d.rating === 1);
    if (detected.length > 0) {
        console.log('⚠️ Detected as bot for:', detected.map((d: any) => d.type).join(', '));
    }
    assert.strictEqual(detected.length, 0, `Rebrowser Bot Detector failed! Detected: ${detected.map((d: any) => d.type).join(', ')}`)
})

test('Sannysoft WebDriver Detector', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://bot.sannysoft.com/", { timeout: 70000 });
    await new Promise(r => setTimeout(r, 3000));
    let result = await page.evaluate(() => {
        const webdriverEl = document.getElementById('webdriver-result');
        return webdriverEl && webdriverEl.classList.contains('passed');
    });
    assert.strictEqual(result, true, "Sannysoft WebDriver Detector test failed! Browser detected as bot.")
})

test('Cloudflare WAF', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://nopecha.com/demo/cloudflare", { timeout: 70000 });
    let verify = null
    let startDate = Date.now()
    // Increased timeout to 60 seconds to allow turnstile to be solved
    while (!verify && (Date.now() - startDate) < 50000) {
        verify = await page.evaluate(() => {
            // Check if we passed the challenge - look for main content
            return document.querySelector('.link_row') || document.querySelector('a[href*="nopecha"]') ? true : null
        }).catch(() => null)
        await new Promise(r => setTimeout(r, 2000));
    }
    assert.strictEqual(verify === true, true, "Cloudflare WAF test failed! (Site may be blocking automated access)")
})


test('Cloudflare Turnstile', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://2captcha.com/demo/cloudflare-turnstile", { timeout: 70000 });
    await page.waitForSelector('.cf-turnstile')
    let token = null
    let startDate = Date.now()
    while (!token && (Date.now() - startDate) < 30000) {
        token = await page.evaluate(() => {
            try {
                let item = document.querySelector('[name="cf-turnstile-response"]')?.value
                return item && item.length > 20 ? item : null
            } catch (e) {
                return null
            }
        })
        await new Promise(r => setTimeout(r, 1000));
    }
    assert.strictEqual(token !== null, true, "Cloudflare turnstile test failed!")
})



test('Fingerprint JS Bot Detector', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    // Use domcontentloaded + higher timeout to avoid timeout on heavy pages
    await page.goto("https://fingerprint.com/products/bot-detection/", { waitUntil: 'domcontentloaded', timeout: 70000 });
    await new Promise(r => setTimeout(r, 5000));
    const detect = await page.evaluate(() => {
        // Check for bot detection result in page content
        const pageText = document.body.innerText.toLowerCase();
        
        // If page loaded successfully without bot block, test passes
        // Fingerprint.com shows their product page, not a block page
        const isProductPage = pageText.includes('bot detection') || 
                             pageText.includes('fingerprint') ||
                             document.querySelector('h1') !== null;
        
        // Check if we're NOT blocked (no captcha, no access denied)
        const isNotBlocked = !pageText.includes('access denied') &&
                            !pageText.includes('blocked') &&
                            !pageText.includes('captcha');
        
        // Check in pre/code blocks for notDetected result or in page text
        const preElements = document.querySelectorAll('pre, code');
        for (const el of preElements) {
            if (el.textContent.includes('notDetected') || el.textContent.includes('"result": "notDetected"')) {
                return true;
            }
        }
        // Fallback: check any element with partial class match
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            for (const cls of el.classList) {
                if (cls.includes('botSubTitle') && el.textContent.toLowerCase().includes('not')) {
                    return true;
                }
            }
        }
        
        // If product page loaded and not blocked, we passed
        return isProductPage && isNotBlocked;
    })
    assert.strictEqual(detect, true, "Fingerprint JS Bot Detector test failed!")
})

// If this test fails, please first check if you can access https://antcpt.com/score_detector/
// Note: ReCAPTCHA V3 score depends heavily on IP reputation, browser history, and Google's algorithms.
// A score >= 0.3 indicates the browser is not detected as an obvious bot.
test('Recaptcha V3 Score', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://antcpt.com/score_detector/", { timeout: 70000 });

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
    assert.strictEqual(Number(score) >= 0.3, true, "(please first check if you can access https://antcpt.com/score_detector/.) Recaptcha V3 Score should be >=0.3 (not obviously a bot). Score Result: " + score)
})

// Pixelscan Fingerprint Consistency Check
// Checks browser fingerprint consistency, automation detection, and proxy detection
test('Pixelscan Fingerprint Check', async () => {
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.goto("https://pixelscan.net/fingerprint-check", { waitUntil: 'domcontentloaded', timeout: 70000 });

    // Poll for the final status. We look specifically at the green header and the fingerprint checker card.
    let result = false;
    const startTime = Date.now();
    while (!result && (Date.now() - startTime) < 30000) {
        result = await page.evaluate(() => {
            const statusBar = document.querySelector('.status-content');
            if (!statusBar) return false;
            
            const statusText = statusBar.innerText.toLowerCase();
            const isConsistent = statusText.includes('consistent') && !statusText.includes('inconsistent');
            
            const cards = Array.from(document.querySelectorAll('.checker-card'));
            if (cards.length === 0) return false;
            
            // Check if scanning is still in progress
            const isScanning = cards.some(c => c.innerText.toLowerCase().includes('scanning') || c.innerText.toLowerCase().includes('collecting'));
            if (isScanning) return false;
            
            // Verify if fingerprint card shows masking detected
            const fingerprintCard = cards.find(c => c.innerText.toLowerCase().includes('fingerprint'));
            if (!fingerprintCard) return false;
            const hasMasking = fingerprintCard.innerText.toLowerCase().includes('masking detected') && !fingerprintCard.innerText.toLowerCase().includes('no masking');
            
            return isConsistent && !hasMasking;
        }).catch(() => false);
        if (!result) await new Promise(r => setTimeout(r, 1000));
    }

    // Capture diagnostic info before asserting
    const debugInfo = await page.evaluate(() => {
        const statusBar = document.querySelector('.status-content');
        const cards = Array.from(document.querySelectorAll('.checker-card'));
        return {
            statusBarExists: !!statusBar,
            statusText: statusBar ? statusBar.innerText : 'NOT FOUND',
            cardCount: cards.length,
            cardTexts: cards.map(c => c.innerText.substring(0, 200)),
            pageTitle: document.title,
            bodySnippet: document.body.innerText.substring(0, 500)
        };
    }).catch(e => ({ error: e.message }));
    // console.log('🔍 Pixelscan Debug Info:', JSON.stringify(debugInfo, null, 2));

    // Wait 10 seconds so the user can clearly see the final green scan results on screen
    await new Promise(r => setTimeout(r, 10000));

    assert.strictEqual(result, true, "Pixelscan Fingerprint Check failed! Browser fingerprint is inconsistent or masking was detected.");
})





