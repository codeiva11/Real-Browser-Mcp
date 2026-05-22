const { connect } = require('./lib/cjs/index.js');
const { chromium } = require('patchright');

async function main() {
    console.log("Launching browser via patchright (headless: true)...");
    const browser = await chromium.launch({
        headless: true,
        executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Connect to CDP session
    const client = await page.context().newCDPSession(page);
    
    console.log("Sending Emulation.setUserAgentOverride via CDP...");
    await client.send('Emulation.setUserAgentOverride', {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        userAgentMetadata: {
            brands: [
                { brand: "Chromium", version: "148" },
                { brand: "Brave", version: "148" },
                { brand: "Not/A)Brand", version: "99" }
            ],
            mobile: false,
            platform: "Windows",
            platformVersion: "10.0.0",
            architecture: "x86",
            model: ""
        }
    });

    // Navigate to https://example.com
    console.log("\n--- Checking on https://example.com ---");
    await page.goto("https://example.com");
    const isSecureExample = await page.evaluate(() => window.isSecureContext);
    console.log("isSecureContext:", isSecureExample);
    const uaExample = await page.evaluate(() => navigator.userAgent);
    console.log("User Agent:", uaExample);
    const uadExample = await page.evaluate(() => navigator.userAgentData ? navigator.userAgentData.brands : null);
    console.log("User Agent Data Brands:", uadExample);

    await browser.close();
}

main().catch(console.error);
