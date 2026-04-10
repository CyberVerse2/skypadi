/**
 * Test ONLY datepicker + form filling. Skips search — goes straight to a listings page.
 */
import { chromium } from "playwright";

const DEEPLINK = "https://www.wakanow.com/flight/listings/kUCDCD8-k4KBtAXVDZmsDA";

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    locale: "en-NG", timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  console.log("1. Loading listings...");
  await page.goto(DEEPLINK, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);

  console.log("2. Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });

  console.log("3. Waiting for customer-info...");
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
  await page.waitForTimeout(5000);
  console.log(`   URL: ${page.url()}`);

  // Fill form
  console.log("\n4. Filling form...");
  await page.locator("select").first().selectOption({ label: "Mr" });
  console.log("   ✓ Title");

  await page.locator("[name='booking_lastname']").first().fill("Chinaza");
  await page.locator("[name='booking_firstname']").first().fill("Celestine");
  console.log("   ✓ Names");

  // === DATEPICKER ===
  console.log("\n5. Opening datepicker...");

  // Click the calendar button
  const calButton = page.locator("button:has(.fa-calendar), button.btn-outline-dark").first();
  if (await calButton.count()) {
    console.log("   Clicking calendar button...");
    await calButton.click({ timeout: 3000 });
  } else {
    console.log("   Calendar button not found, clicking input...");
    await page.locator("input[placeholder='yyyy-mm-dd']").first().click({ timeout: 3000 });
  }
  await page.waitForTimeout(1000);

  const dpSelects = page.locator("ngb-datepicker select");
  const dpCount = await dpSelects.count();
  console.log(`   Datepicker selects: ${dpCount}`);

  if (dpCount >= 2) {
    // Log current state
    for (let i = 0; i < dpCount; i++) {
      const val = await dpSelects.nth(i).inputValue();
      const label = await dpSelects.nth(i).getAttribute("aria-label") ?? "?";
      console.log(`   Select ${i}: "${label}" = "${val}"`);
    }

    // Year first (index 1), then month (index 0)
    console.log("   Setting year to 1995...");
    await dpSelects.nth(1).selectOption("1995");
    await page.waitForTimeout(500);
    console.log(`   Year now: ${await dpSelects.nth(1).inputValue()}`);

    console.log("   Setting month to 3 (March)...");
    await dpSelects.nth(0).selectOption("3");
    await page.waitForTimeout(500);
    console.log(`   Month now: ${await dpSelects.nth(0).inputValue()}`);

    console.log("   Clicking day 20...");
    const result = await page.evaluate(() => {
      const cells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
      for (const cell of cells) {
        if ((cell.textContent ?? "").trim() === "20" && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click();
          return "clicked";
        }
      }
      return "not found — visible days: " + Array.from(cells).slice(0, 10).map(c => c.textContent?.trim()).join(",");
    });
    console.log(`   Day: ${result}`);
    await page.waitForTimeout(500);
  }

  const dobVal = await page.locator("input[placeholder='yyyy-mm-dd']").first().inputValue();
  console.log(`\n   DOB value: "${dobVal}"`);

  // Gender
  await page.locator("#Male0").click({ timeout: 3000 }).catch(() =>
    page.evaluate(() => (document.getElementById("Male0") as any)?.click())
  );
  console.log("   ✓ Gender");

  // Phone & Email
  await page.locator("[name='PhoneNumber']").first().fill("08134278512");
  await page.locator("input[type='email']").first().fill("coinswagapp@gmail.com");
  console.log("   ✓ Phone & Email");

  await page.screenshot({ path: "/tmp/skypadi-form-test.png", fullPage: true });
  console.log("\nScreenshot → /tmp/skypadi-form-test.png");
  console.log("\n=== NOT SUBMITTING. Browser open for 2 min. Ctrl+C to close. ===");
  await page.waitForTimeout(120_000);
  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
