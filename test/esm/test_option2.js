import playwright from "playwright-ghost/patchright";
import recommended from "playwright-ghost/plugins/recommended";

console.log("🚀 Starting Option 2 Demonstration...");

try {
  // Launch browser with playwright-ghost overlay & recommended stealth/humanize plugins
  console.log("Launching browser with Option 2 (playwright-ghost overlay & recommended plugins)...");
  const browser = await playwright.chromium.launch({
    headless: false, // Set to false so you can see it if run locally, but works in headless too
    plugins: [recommended()]
  });
  console.log("✅ Browser launched successfully!");

  const context = await browser.newContext();
  const page = await context.newPage();
  console.log("✅ Page created!");

  // Go to DrissionPage Detector
  console.log("Navigating to DrissionPage Detector page...");
  await page.goto("https://web.archive.org/web/20240913054632/https://drissionpage.pages.dev/", { timeout: 60000 });
  console.log("✅ Page loaded successfully!");

  console.log("Triggering normal, standard page.click('#detector')!");
  console.log("👉 Option 2 will intercept this click, calculate a Bézier curve path, scroll it into view, move the cursor humanly, and then click!");
  
  const startTime = Date.now();
  await page.click("#detector");
  console.log(`✅ Standard click intercepted and completed in ${(Date.now() - startTime) / 1000}s!`);

  // Verify the detector says "not a bot"
  const isNotBot = await page.evaluate(() => {
    return document.querySelector('#isBot span').textContent.includes("not");
  });

  if (isNotBot) {
    console.log("🎉 SUCCESS! The detector passed: 'not a bot'.");
  } else {
    console.log("❌ FAILED! Detected as bot.");
  }

  await browser.close();
  console.log("🏁 Browser closed. Demonstration completed successfully.");
} catch (error) {
  console.error("❌ An error occurred during the demonstration:", error);
}
