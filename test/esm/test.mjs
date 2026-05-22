import test from 'node:test';
import assert from 'node:assert';
import { connect } from '../../lib/esm/index.mjs';

const realBrowserOption = {
    turnstile: true,
    headless: true,
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
    await page.goto("https://web.archive.org/web/20240913054632/https://drissionpage.pages.dev/", { timeout: 70000 });
    await page.realClick("#detector")
    let result = await page.evaluate(() => { return document.querySelector('#isBot span').textContent.includes("not") ? true : false })
    assert.strictEqual(result, true, "DrissionPage Detector test failed!")
})

test('Sannysoft WebDriver Detector', async () => {
    await page.goto("https://bot.sannysoft.com/", { timeout: 70000 });
    await new Promise(r => setTimeout(r, 3000));
    let result = await page.evaluate(() => {
        const webdriverEl = document.getElementById('webdriver-result');
        return webdriverEl && webdriverEl.classList.contains('passed');
    });
    assert.strictEqual(result, true, "Sannysoft WebDriver Detector test failed! Browser detected as bot.")
})

test('Cloudflare WAF', async () => {
    await page.goto("https://nopecha.com/demo/cloudflare", { timeout: 70000 });
    let verify = null
    let startDate = Date.now()
    while (!verify && (Date.now() - startDate) < 50000) {
        verify = await page.evaluate(() => {
            return document.querySelector('.link_row') || document.querySelector('a[href*="nopecha"]') ? true : null
        }).catch(() => null)
        await new Promise(r => setTimeout(r, 2000));
    }
    assert.strictEqual(verify === true, true, "Cloudflare WAF test failed! (Site may be blocking automated access)")
})


test('Cloudflare Turnstile', async () => {
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
    await page.goto("https://fingerprint.com/products/bot-detection/", { waitUntil: 'domcontentloaded', timeout: 70000 });
    await new Promise(r => setTimeout(r, 5000));
    const detect = await page.evaluate(() => {
        const pageText = document.body.innerText.toLowerCase();
        
        const isProductPage = pageText.includes('bot detection') || 
                             pageText.includes('fingerprint') ||
                             document.querySelector('h1') !== null;
        
        const isNotBlocked = !pageText.includes('access denied') &&
                             !pageText.includes('blocked') &&
                             !pageText.includes('captcha');
        
        const preElements = document.querySelectorAll('pre, code');
        for (const el of preElements) {
            if (el.textContent.includes('notDetected') || el.textContent.includes('"result": "notDetected"')) {
                return true;
            }
        }
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            for (const cls of el.classList) {
                if (cls.includes('botSubTitle') && el.textContent.toLowerCase().includes('not')) {
                    return true;
                }
            }
        }
        
        return isProductPage && isNotBlocked;
    })
    assert.strictEqual(detect, true, "Fingerprint JS Bot Detector test failed!")
})

test('Recaptcha V3 Score', async () => {
    await page.goto("https://antcpt.com/score_detector/", { timeout: 70000 });

    await page.realCursor.move('body', { paddingPercentage: 20 });
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    await page.mouse.wheel(0, 100 + Math.random() * 100);
    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));

    await page.realCursor.move('button', { paddingPercentage: 10 });
    await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

    await page.realClick("button")
    await new Promise(r => setTimeout(r, 5000));

    const score = await page.evaluate(() => {
        return document.querySelector('big').textContent.replace(/[^0-9.]/g, '')
    })
    assert.strictEqual(Number(score) >= 0.3, true, "(please first check if you can access https://antcpt.com/score_detector/.) Recaptcha V3 Score should be >=0.3 (not obviously a bot). Score Result: " + score)
})

test('Pixelscan Fingerprint Check', async () => {
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

    // Wait 10 seconds so the user can clearly see the final green scan results on screen
    await new Promise(r => setTimeout(r, 10000));

    assert.strictEqual(result, true, "Pixelscan Fingerprint Check failed! Browser fingerprint is inconsistent or masking was detected.");
})
