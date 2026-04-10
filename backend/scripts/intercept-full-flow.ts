/**
 * Full browser booking flow: listings → book → fill form → continue → addons → pay now → payment
 * Captures all API calls to understand the complete flow.
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  // Step 1: Get a search key via API
  console.log("Step 1: Searching flights via API...");
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 3 });
  console.log(`  Found ${search.resultCount} flights`);
  const listingsUrl = search.results[0].deeplink;
  console.log(`  Listings URL: ${listingsUrl}`);

  // Step 2: Launch browser
  console.log("\nStep 2: Launching browser...");
  const browser = await chromium.launch({ headless: false, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  // Intercept Wakanow API calls only
  const apiCalls: { phase: string; method: string; url: string; reqBody: string | null; status: number; resBody: string }[] = [];
  let currentPhase = "listings";

  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();
    if (!url.includes("wakanow.com") || /\.(js|css|png|jpg|svg|woff|woff2|ttf|ico)(\?|$)/i.test(url)) return;
    if (/google|facebook|fb\.|optimonk|clarity|analytics|gtm|doubleclick|bing|freshchat/i.test(url)) return;
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;

    const ct = res.headers()["content-type"] ?? "";
    const isJson = ct.includes("json");
    let body = "";
    try { body = await res.text(); } catch { body = "<unreadable>"; }

    apiCalls.push({
      phase: currentPhase,
      method: req.method(),
      url,
      reqBody: req.postData() ?? null,
      status: res.status(),
      resBody: body.slice(0, 5000)
    });

    console.log(`  [${currentPhase}] ${req.method()} ${url.slice(0, 130)} -> ${res.status()}${isJson ? " [JSON]" : ""}`);
    if (req.postData()) console.log(`    REQ: ${req.postData()!.slice(0, 300)}`);
    if (isJson) console.log(`    RES: ${body.slice(0, 500)}`);
  });

  // Step 3: Navigate to listings
  console.log("\nStep 3: Loading listings page...");
  await page.goto(listingsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);
  console.log(`  Loaded. URL: ${page.url()}`);

  // Step 4: Click Book Now on first flight
  currentPhase = "book-click";
  console.log("\nStep 4: Clicking 'Book Now'...");
  const bookBtn = page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first();
  await bookBtn.click({ timeout: 5000 });

  // Step 5: Wait for customer-info page
  currentPhase = "customer-info";
  console.log("\nStep 5: Waiting for customer-info page...");
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => console.log("  Did not navigate to customer-info. URL:", page.url()));
  await page.waitForTimeout(5000);
  console.log(`  URL: ${page.url()}`);

  // Extract booking ID from URL
  const bookingId = page.url().match(/booking\/(\d+)\//)?.[1];
  console.log(`  BookingId: ${bookingId}`);

  // Step 6: Fill passenger form
  currentPhase = "form-fill";
  console.log("\nStep 6: Filling passenger form...");

  // Title
  await page.locator("select").first().selectOption({ label: "Mr" }).catch(() => {});
  await page.waitForTimeout(300);

  // Last name, First name
  await page.locator("[name='booking_lastname']").first().fill("Doe").catch(() => {});
  await page.locator("[name='booking_firstname']").first().fill("John").catch(() => {});
  await page.locator("[name='booking_middlename']").first().fill("").catch(() => {});
  await page.waitForTimeout(300);

  // DOB via datepicker
  const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();
  await dobInput.click({ timeout: 3000 }).catch(() => {});
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
        (cell as HTMLElement).click();
        return;
      }
    }
  }).catch(() => {});
  await page.waitForTimeout(500);

  // Nationality
  await page.evaluate(() => {
    const natInput = document.querySelector<HTMLInputElement>("input[formcontrolname*='ationality'], input[formcontrolname*='nationality']");
    if (natInput) {
      natInput.focus();
      natInput.value = "Nigerian";
      natInput.dispatchEvent(new Event("input", { bubbles: true }));
      natInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }).catch(() => {});
  await page.waitForTimeout(800);
  const suggestion = page.locator("[role='listbox']:visible, .dropdown-menu:visible, ngb-typeahead-window:visible").locator("text=/Nigerian/i").first();
  if (await suggestion.count()) await suggestion.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Gender
  await page.locator("#Male0").click({ timeout: 2000 }).catch(() =>
    page.evaluate(() => { (document.getElementById("Male0") as HTMLInputElement)?.click(); })
  ).catch(() => {});
  await page.waitForTimeout(300);

  // Phone & Email
  await page.locator("[name='PhoneNumber']").first().fill("08012345678").catch(() => {});
  await page.locator("input[type='email']").first().fill("test@example.com").catch(() => {});
  await page.waitForTimeout(1000);
  console.log("  Form filled.");

  // Step 7: Accept terms and click Continue
  currentPhase = "form-submit";
  console.log("\nStep 7: Accepting terms and clicking Continue...");
  const checkbox = page.locator("#acceptTermsAndCondition");
  if (!(await checkbox.isChecked().catch(() => false))) {
    await checkbox.click({ timeout: 2000 }).catch(() => checkbox.evaluate((el) => (el as HTMLInputElement).click())).catch(() => {});
  }
  await page.waitForTimeout(500);

  const continueBtn = page.locator("button:has-text('Continue'), a:has-text('Continue')").first();
  if (await continueBtn.count()) {
    await continueBtn.click({ timeout: 5000 });
    console.log("  Clicked Continue.");
  }

  // Step 8: Wait for addons page
  currentPhase = "addons-load";
  console.log("\nStep 8: Waiting for addons page...");
  await page.waitForTimeout(10_000);
  console.log(`  URL: ${page.url()}`);

  // Step 9: Click Pay Now on addons page
  currentPhase = "pay-now-click";
  if (page.url().includes("/addons")) {
    console.log("\nStep 9: On addons page, clicking Pay Now...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const paySelectors = ["text=/pay\\s*now/i", "text=/proceed.*payment/i", "text=/continue.*payment/i", "button:has-text('Pay')"];
    let clicked = false;
    for (const sel of paySelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        const text = await el.textContent();
        console.log(`  Found: "${text?.trim()}" — clicking...`);
        await el.click({ timeout: 5000 });
        clicked = true;
        break;
      }
    }
    if (!clicked) console.log("  No Pay Now button found!");
  }

  // Step 10: Wait for payment page
  currentPhase = "payment";
  console.log("\nStep 10: Waiting for payment page...");
  await page.waitForTimeout(15_000);
  console.log(`  URL: ${page.url()}`);

  // Capture payment page content
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
  console.log("\n=== PAYMENT PAGE TEXT ===");
  console.log(pageText.slice(0, 5000));
  console.log("=== END ===");

  // Look for bank transfer button and click it
  const bankBtn = page.locator("text=/bank.?transfer|pay.?to.?bank|direct.?deposit/i").first();
  if (await bankBtn.count()) {
    currentPhase = "bank-transfer";
    console.log("\nClicking bank transfer...");
    await bankBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const afterText = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log("\n=== AFTER BANK TRANSFER CLICK ===");
    console.log(afterText.slice(0, 5000));
    console.log("=== END ===");
  }

  // Print summary of all Wakanow API calls
  console.log("\n" + "=".repeat(80));
  console.log("WAKANOW API CALLS SUMMARY");
  console.log("=".repeat(80));
  const phases = [...new Set(apiCalls.map(c => c.phase))];
  for (const phase of phases) {
    const calls = apiCalls.filter(c => c.phase === phase);
    console.log(`\n--- ${phase} (${calls.length} calls) ---`);
    for (const c of calls) {
      console.log(`  ${c.method} ${c.url.slice(0, 130)} -> ${c.status}`);
      if (c.reqBody) console.log(`    REQ: ${c.reqBody.slice(0, 300)}`);
      console.log(`    RES: ${c.resBody.slice(0, 500)}`);
    }
  }

  await browser.close();
}

main().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
