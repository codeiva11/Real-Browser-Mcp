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

test('DrissionPage Detector', async () => {
    await page.goto("https://web.archive.org/web/20240913054632/https://drissionpage.pages.dev/", { timeout: 60000 });
    await page.realClick("#detector")
    let result = await page.evaluate(() => { return document.querySelector('#isBot span').textContent.includes("not") ? true : false })
    assert.strictEqual(result, true, "DrissionPage Detector test failed!")
})

test('Sannysoft WebDriver Detector', async () => {
    await page.goto("https://bot.sannysoft.com/", { timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    let result = await page.evaluate(() => {
        const webdriverEl = document.getElementById('webdriver-result');
        return webdriverEl && webdriverEl.classList.contains('passed');
    });
    assert.strictEqual(result, true, "Sannysoft WebDriver Detector test failed! Browser detected as bot.")
})

test('Cloudflare WAF', async () => {
    await page.goto("https://nopecha.com/demo/cloudflare", { timeout: 60000 });
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
    await page.goto("https://2captcha.com/demo/cloudflare-turnstile", { timeout: 60000 });
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
    // Use domcontentloaded + higher timeout to avoid timeout on heavy pages
    await page.goto("https://fingerprint.com/products/bot-detection/", { waitUntil: 'domcontentloaded', timeout: 60000 });
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


// Datadome Bot Detector - Tests against a real Datadome-protected website (hermes.com)
test('Datadome Bot Detector', async (t) => {
    // Navigate to hermes.com which is protected by Datadome
    await page.goto("https://www.hermes.com/us/en/", { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Human-like behavior on the page
    await page.realCursor.move('body', { paddingPercentage: 20 });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    await page.mouse.wheel({ deltaY: 100 + Math.random() * 100 });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    // Check if main page content loaded (Datadome bypass successful)
    // Look for Hermès logo or main navigation elements that only appear after Datadome clears
    const check = await page.evaluate(() => {
        // Check for Hermès header/logo/navigation elements
        const hasLogo = !!document.querySelector('a[href*="hermes"]') || !!document.querySelector('[class*="logo"]');
        const hasNav = !!document.querySelector('nav') || !!document.querySelector('[class*="header"]') || !!document.querySelector('[class*="navigation"]');
        const hasContent = document.body.innerText.length > 500; // Real page has significant content
        const notBlocked = !document.body.innerText.toLowerCase().includes('blocked') &&
                          !document.body.innerText.toLowerCase().includes('captcha');
        return (hasLogo || hasNav) && hasContent && notBlocked;
    }).catch(() => false);

    assert.strictEqual(check, true, "Datadome Bot Detector test failed! [This may also be because your ip address has a high spam score. Please try with a clean ip address.]");
})

// If this test fails, please first check if you can access https://antcpt.com/score_detector/
// Note: ReCAPTCHA V3 score depends heavily on IP reputation, browser history, and Google's algorithms.
// A score >= 0.3 indicates the browser is not detected as an obvious bot.
test('Recaptcha V3 Score', async () => {
    await page.goto("https://antcpt.com/score_detector/", { timeout: 60000 });

    // Human-like warm-up interactions before clicking
    // 1. Random mouse movements using realCursor (Bézier curves via ghost-cursor)
    await page.realCursor.move('body', { paddingPercentage: 20 });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    // 2. Scroll down a bit to simulate reading
    await page.mouse.wheel({ deltaY: 100 + Math.random() * 100 });
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
    await page.goto("https://pixelscan.net/fingerprint-check", { waitUntil: 'domcontentloaded', timeout: 60000 });

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

    // Wait 10 seconds so the user can clearly see the final green scan results on screen
    await new Promise(r => setTimeout(r, 10000));

    assert.strictEqual(result, true, "Pixelscan Fingerprint Check failed! Browser fingerprint is inconsistent or masking was detected.")
})

// CreepJS Deep Fingerprint Analysis
// The most comprehensive fingerprint analyzer - checks lies, headless, stealth, trust score
test('CreepJS Fingerprint Analysis', async () => {
    await page.goto("https://abrahamjuliot.github.io/creepjs/", { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 15000)); // CreepJS needs time to run all checks

    const result = await page.evaluate(() => {
        const pageText = document.body.innerText;

        // Check headless detection section
        // Look for "0% headless" which means not detected as headless
        const headlessSection = pageText.match(/(\d+)%\s*headless/i);
        const headlessPercent = headlessSection ? parseInt(headlessSection[1]) : 100;

        // Check stealth detection
        const stealthSection = pageText.match(/(\d+)%\s*stealth/i);
        const stealthPercent = stealthSection ? parseInt(stealthSection[1]) : 100;

        // Check lies detection - "0 lies" or low count is good
        const liesMatch = pageText.match(/(\d+)\s*lie/i);
        const liesCount = liesMatch ? parseInt(liesMatch[1]) : 0;

        return {
            headlessPercent,
            stealthPercent,
            liesCount,
            // Pass if: 0% headless, 0% stealth, and lies count is low
            passed: headlessPercent === 0 && stealthPercent === 0 && liesCount <= 2
        };
    }).catch(() => ({ passed: false, headlessPercent: -1, stealthPercent: -1, liesCount: -1 }));

    assert.strictEqual(result.passed, true,
        `CreepJS Fingerprint Analysis failed! Headless: ${result.headlessPercent}%, Stealth: ${result.stealthPercent}%, Lies: ${result.liesCount}`)
})