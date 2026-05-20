import playwright from "playwright-ghost/patchright";
import recommended from "playwright-ghost/plugins/recommended";

console.log("🚀 Testing playwright-ghost integration...");

try {
  const browser = await playwright.chromium.launch({
    headless: true,
    plugins: [recommended()]
  });
  console.log("✅ Browser launched successfully with playwright-ghost!");

  const context = await browser.newContext();
  const page = await context.newPage();
  console.log("✅ Context and page created!");

  console.log("Navigating to simple website...");
  await page.goto("https://example.com");
  console.log("✅ Navigated successfully!");

  console.log("Attempting humanized click on link...");
  const link = page.locator("a");
  await link.click();
  console.log("✅ Clicked successfully!");

  await browser.close();
  console.log("🎉 Test completed successfully!");
} catch (error) {
  console.error("❌ Test failed:", error);
}
