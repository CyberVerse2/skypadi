/**
 * Full browser flow → click "Continue To See Bank Transfer Details" → capture API call
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  console.log("Step 1: Searching...");
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 3 });
  const flight = search.results[0];
  console.log(`  ${flight.airline} ${flight.departureTime} ${flight.priceText}`);

  const browser = await chromium.launch({ headless: false, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({ locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" });
  const page = await context.newPage();

  // Only intercept Wakanow booking API calls
  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();
    if (!url.includes("wakanow.com") || /\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(url)) return;
    if (/google|facebook|analytics|gtm|freshchat|clarity|optimonk/i.test(url)) return;
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;
    const ct = res.headers()["content-type"] ?? "";
    const isJson = ct.includes("json");
    let body = "";
    try { body = await res.text(); } catch { body = "<unreadable>"; }
    console.log(`  [API] ${req.method()} ${url.slice(0, 150)} -> ${res.status()}${isJson ? " [JSON]" : ""}`);
    if (req.postData()) console.log(`    REQ: ${req.postData()!.slice(0, 500)}`);
    if (isJson) console.log(`    RES: ${body.slice(0, 2000)}`);
  });

  // Navigate to listings
  console.log("\nStep 2: Loading listings...");
  await page.goto(search.results[0].deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);

  // Click Book Now
  console.log("\nStep 3: Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });

  // Wait for customer-info
  console.log("\nStep 4: Filling form...");
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Fill form
  await page.locator("select").first().selectOption({ label: "Mr" }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("[name='booking_lastname']").first().fill("Doe").catch(() => {});
  await page.locator("[name='booking_firstname']").first().fill("John").catch(() => {});
  await page.locator("[name='booking_middlename']").first().fill("").catch(() => {});

  // DOB
  await page.locator("input[placeholder='yyyy-mm-dd']").first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const selects = document.querySelectorAll<HTMLSelectElement>("ngb-datepicker select");
    for (const sel of selects) {
      const label = sel.getAttribute("aria-label") ?? "";
      if (/year/i.test(label)) { sel.value = "1990"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      if (/month/i.test(label)) { sel.value = "6"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const dayCells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
    for (const cell of dayCells) {
      if ((cell.textContent ?? "").trim() === "15" && !cell.classList.contains("ngb-dp-day--outside")) {
        (cell as HTMLElement).click(); return;
      }
    }
  }).catch(() => {});
  await page.waitForTimeout(500);

  // Nationality
  await page.evaluate(() => {
    const natInput = document.querySelector<HTMLInputElement>("input[formcontrolname*='ationality'], input[formcontrolname*='nationality']");
    if (natInput) { natInput.focus(); natInput.value = "Nigerian"; natInput.dispatchEvent(new Event("input", { bubbles: true })); }
  }).catch(() => {});
  await page.waitForTimeout(800);
  const suggestion = page.locator("[role='listbox']:visible, ngb-typeahead-window:visible").locator("text=/Nigerian/i").first();
  if (await suggestion.count()) await suggestion.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Gender
  await page.locator("#Male0").click({ timeout: 2000 }).catch(() => page.evaluate(() => (document.getElementById("Male0") as any)?.click())).catch(() => {});

  // Phone & Email
  await page.locator("[name='PhoneNumber']").first().fill("08012345678").catch(() => {});
  await page.locator("input[type='email']").first().fill("test@example.com").catch(() => {});
  await page.waitForTimeout(1000);

  // Accept terms & Continue
  console.log("\nStep 5: Submitting form...");
  const cb = page.locator("#acceptTermsAndCondition");
  if (!(await cb.isChecked().catch(() => false))) await cb.click({ timeout: 2000 }).catch(() => cb.evaluate(el => (el as any).click())).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator("button:has-text('Continue'), a:has-text('Continue')").first().click({ timeout: 5000 });

  // Wait for addons
  console.log("\nStep 6: Waiting for addons...");
  await page.waitForTimeout(10_000);
  console.log(`  URL: ${page.url()}`);

  // Click Pay Now
  if (page.url().includes("/addons")) {
    console.log("\nStep 7: Clicking Pay Now...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    await page.locator("text=/pay\\s*now/i").first().click({ timeout: 5000 });
  }

  // Wait for payment page
  console.log("\nStep 8: Waiting for payment page...");
  await page.waitForTimeout(10_000);
  console.log(`  URL: ${page.url()}`);

  // Click Bank Transfer
  console.log("\nStep 9: Clicking Bank Transfer...");
  const bankBtn = page.locator("text=/bank.?transfer/i").first();
  if (await bankBtn.count()) {
    await bankBtn.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    console.log("  Clicked Bank Transfer");
  }

  // Click "Continue To See Bank Transfer Details"
  console.log("\nStep 10: Clicking 'Continue To See Bank Transfer Details'...");
  const continueBank = page.locator("text=/continue.*bank.*transfer.*details/i").first();
  if (await continueBank.count()) {
    console.log("  Found button — clicking...");
    await continueBank.click({ timeout: 5000 });
    await page.waitForTimeout(10_000);

    // Capture page text after click
    const afterText = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log("\n=== AFTER CONTINUE BANK TRANSFER ===");
    console.log(afterText.slice(0, 5000));
    console.log("=== END ===");
  } else {
    console.log("  Button not found. Page text:");
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log(text.slice(0, 3000));
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
