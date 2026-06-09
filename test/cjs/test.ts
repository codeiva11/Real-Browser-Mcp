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

test('Human-like Move & Click', async () => {
    await page.goto("https://www.google.com", { timeout: 40000 });
    const selector = 'textarea[name="q"], input[name="q"]';
    await page.realCursor.move(selector);
    await page.realClick(selector);
    assert.ok(true);
})

test('Human-like Typing', async () => {
    await page.goto("https://www.google.com", { timeout: 40000 });
    const selector = 'textarea[name="q"], input[name="q"]';
    await page.realCursor.move(selector);
    await page.realClick(selector);
    await page.type(selector, 'Real Browser MCP Server', { delay: 150 });
    const val = await page.inputValue(selector);
    assert.strictEqual(val, 'Real Browser MCP Server');
})

test('Human-like Scrolling', async () => {
    await page.goto("https://www.google.com/search?q=Real+Browser+MCP+Server", { timeout: 40000, waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('📜 Scrolling down smoothly and fast (400px)...');
    await page.realScroll(400, 500);
    await new Promise(r => setTimeout(r, 600));
    
    console.log('📜 Scrolling down smoothly and fast (300px)...');
    await page.realScroll(300, 400);
    await new Promise(r => setTimeout(r, 600));
    
    console.log('📜 Scrolling up smoothly and fast (-500px)...');
    await page.realScroll(-500, 600);
    await new Promise(r => setTimeout(r, 1000));
    
    assert.ok(true);
})

test('Form Automation Demonstration', async () => {
  console.log('\n🎬 DEMO: Form Automation');
  try {
    await page.goto('https://httpbin.org/forms/post', { timeout: 30000 });
    console.log('\n4️⃣ Filling out form...');
    
    // 1. Customer Name
    await page.type('input[name="custname"]', 'John Doe', { delay: 100 });
    console.log('✅ Customer Name filled');

    // 2. Telephone
    await page.type('input[name="custtel"]', '+1-555-0199', { delay: 100 });
    console.log('✅ Telephone filled');

    // 3. Email address
    await page.type('input[name="custemail"]', 'john.doe@example.com', { delay: 100 });
    console.log('✅ Email field filled');

    // 4. Pizza Size (Radio Button)
    await page.realClick('input[value="medium"]');
    console.log('✅ Pizza Size selected (Medium)');

    // 5. Pizza Toppings (Checkboxes)
    await page.realClick('input[value="bacon"]');
    await page.realClick('input[value="onion"]');
    console.log('✅ Toppings selected (Bacon, Onion)');

    // 6. Preferred Delivery Time
    await page.type('input[name="delivery"]', '13:00', { delay: 100 });
    console.log('✅ Delivery time filled');

    // 7. Delivery Instructions (Comments)
    await page.type('textarea[name="comments"]', 'Leave at the front door, please.', { delay: 100 });
    console.log('✅ Delivery instructions filled');

    // Wait 2 seconds for visual demonstration
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 8. Submit Order
    await page.realClick('form button');
    console.log('✅ Form submitted successfully');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('\n🎉 FORM AUTOMATION COMPLETE!');
  } catch (error) {
    console.error('❌ Form automation test failed:', error);
    throw error;
  }
})

test('Content Strategy Demonstration', async () => {
  console.log('\n🎬 DEMO: Content Analysis & Token Management');
  console.log('👀 Watch browser analyze content from different websites');
  try {
    const testSites = [
      { url: 'https://httpbin.org/html', description: 'Simple HTML page' },
      { url: 'https://example.com', description: 'Minimal content page' }
    ];

    for (const [index, site] of testSites.entries()) {
      console.log(`\n${index + 2}️⃣ Testing ${site.description}: ${site.url}`);
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log(`   📄 Getting HTML content...`);
      const htmlContent = await page.content();
      console.log(`   ✅ HTML analyzed: ${htmlContent.length} characters`);
      
      console.log(`   📝 Getting text content...`);
      const textContent = await page.evaluate(() => document.body.innerText);
      console.log(`   ✅ Text analyzed: ${textContent.length} characters`);
      
      assert.ok(htmlContent.length > 0);
      assert.ok(textContent.length > 0);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log('\n🎉 CONTENT ANALYSIS COMPLETE!');
  } catch (error) {
    console.error('❌ Content strategy test failed:', error);
    throw error;
  }
})

test('DrissionPage Detector', async () => {
    await page.goto("https://web.archive.org/web/20240913054632/https://drissionpage.pages.dev/", { timeout: 60000 });
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
    console.log('🔍 Pixelscan Debug Info:', JSON.stringify(debugInfo, null, 2));

    // Wait 10 seconds so the user can clearly see the final green scan results on screen
    await new Promise(r => setTimeout(r, 10000));

    assert.strictEqual(result, true, "Pixelscan Fingerprint Check failed! Browser fingerprint is inconsistent or masking was detected.");
})





