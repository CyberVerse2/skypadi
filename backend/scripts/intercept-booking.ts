/**
 * Intercept ALL Wakanow API calls during the booking flow.
 *
 * Flow:
 *   1. Search for flights (POST Search API -> get requestKey)
 *   2. Navigate to listings page with that key
 *   3. Click "Book Now" on the first flight
 *   4. Fill out the passenger/customer-info form
 *   5. Accept terms and click Continue
 *   6. Capture every API call made during steps 2-5
 *
 * Usage:
 *   npx tsx scripts/intercept-booking.ts [--headed] [--departure LOS] [--destination ABV] [--date 4/25/2026]
 *
 * Output: logs method, URL, request body, response status, and response body
 * for every XHR/fetch call to wakanow domains.
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

// ---------- types ----------

type InterceptedCall = {
  seq: number;
  timestamp: string;
  phase: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
};

// ---------- CLI args ----------

function parseArgs() {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  return {
    headed: args.includes("--headed"),
    departure: flag("departure", "Lagos"),
    destination: flag("destination", "Abuja"),
    date: flag("date", "2026-04-15"),
  };
}

// ---------- main ----------

async function main() {
  const opts = parseArgs();
  const intercepted: InterceptedCall[] = [];
  let seq = 0;
  let currentPhase = "init";

  // ---- Step 1: create a search via our existing API service ----
  console.log("Step 1: Searching flights via API...");
  const searchResult = await searchFlightsApi({
    origin: opts.departure,
    destination: opts.destination,
    departureDate: opts.date,
    maxResults: 5
  });
  console.log(`  Found ${searchResult.resultCount} flights`);
  const listingsUrl = searchResult.results[0].deeplink;
  console.log(`\nStep 2: Launching browser and navigating to ${listingsUrl}`);

  // ---- Step 2: launch browser and intercept ----
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // ---- set up network interception ----
  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();

    // Skip non-wakanow domains, static assets, analytics, etc.
    if (
      !url.includes("wakanow.com") ||
      /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico)(\?|$)/i.test(url) ||
      /google|facebook|fb\.|optimonk|clarity|analytics|gtm|doubleclick|bing\./i.test(url)
    ) {
      return;
    }

    // We want XHR, fetch, and document (navigation) requests
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch" && rtype !== "document") return;

    let responseBody = "";
    try {
      responseBody = await res.text();
    } catch {
      responseBody = "<could not read body>";
    }

    // For document responses that are large HTML, truncate heavily
    const ct = res.headers()["content-type"] ?? "";
    const isJson = ct.includes("json");
    const maxBody = isJson ? 100000 : 1000;

    const entry: InterceptedCall = {
      seq: ++seq,
      timestamp: new Date().toISOString(),
      phase: currentPhase,
      method: req.method(),
      url,
      requestHeaders: req.headers(),
      requestBody: req.postData() ?? null,
      status: res.status(),
      responseHeaders: res.headers(),
      responseBody: responseBody.slice(0, maxBody),
    };

    intercepted.push(entry);

    // Live log for visibility
    const marker = isJson ? "[JSON]" : `[${ct.split(";")[0]}]`;
    console.log(
      `  #${entry.seq} [${entry.phase}] ${req.method()} ${url.slice(0, 120)} -> ${res.status()} ${marker} (${responseBody.length} bytes)`
    );
    if (req.postData()) {
      console.log(`    REQ BODY: ${req.postData()!.slice(0, 300)}`);
    }
    if (isJson) {
      console.log(`    RES BODY: ${responseBody.slice(0, 300)}`);
    }
  });

  // ---- navigate to listings page ----
  currentPhase = "listings";
  await page.goto(listingsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for flight cards
  await page
    .locator("div.flight-fare-detail-wrap")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3_000);
  console.log(`\n  Listings loaded. URL: ${page.url()}`);

  // ---- Step 3: click Book Now on first flight ----
  currentPhase = "book-click";
  console.log("\nStep 3: Clicking 'Book Now' on first flight...");
  const cards = page.locator("div.flight-fare-detail-wrap");
  const cardCount = await cards.count();
  console.log(`  Found ${cardCount} flight cards`);

  const bookBtn = cards.first().locator("text=Book Now").first();
  if (!(await bookBtn.count())) {
    console.error("  No 'Book Now' button found.");
    await dumpAndExit(intercepted, browser);
    return;
  }
  await bookBtn.click({ timeout: 5_000 });

  // ---- Step 4: wait for booking form ----
  currentPhase = "customer-info-load";
  console.log("\nStep 4: Waiting for customer-info page...");
  await page
    .waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 })
    .catch(() => console.log("  Did not navigate to customer-info. URL:", page.url()));
  await page.waitForTimeout(5_000);
  console.log(`  Booking form URL: ${page.url()}`);

  // ---- Step 5: fill passenger form ----
  currentPhase = "form-fill";
  console.log("\nStep 5: Filling passenger form with test data...");

  // Title
  const titleSelect = page.locator("select").first();
  await titleSelect.selectOption({ label: "Mr" }).catch(() => undefined);
  await page.waitForTimeout(300);

  // Last name
  await page.locator("[name='booking_lastname']").first().fill("Doe").catch(() => undefined);
  // First name
  await page.locator("[name='booking_firstname']").first().fill("John").catch(() => undefined);
  // Middle name
  await page.locator("[name='booking_middlename']").first().fill("Test").catch(() => undefined);

  // Date of birth (try direct input)
  const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();
  await dobInput.click({ timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(500);

  // Set DOB via datepicker selects
  await page.evaluate(() => {
    const selects = document.querySelectorAll<HTMLSelectElement>("ngb-datepicker select");
    for (const sel of selects) {
      const label = sel.getAttribute("aria-label") ?? "";
      if (/year/i.test(label)) {
        sel.value = "1990";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (/month/i.test(label)) {
        sel.value = "6";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(500);

  // Click day 15
  await page
    .evaluate(() => {
      const dayCells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
      for (const cell of dayCells) {
        const text = (cell.textContent ?? "").trim();
        if (text === "15" && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click();
          return;
        }
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  // Nationality
  await page
    .evaluate(() => {
      const natInput = document.querySelector<HTMLInputElement>(
        "input[formcontrolname*='ationality'], input[formcontrolname*='nationality']"
      );
      if (natInput) {
        natInput.focus();
        natInput.value = "Nigerian";
        natInput.dispatchEvent(new Event("input", { bubbles: true }));
        natInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(800);

  // Click suggestion if it appears
  const suggestion = page
    .locator(
      "[role='listbox']:visible, .dropdown-menu:visible, ngb-typeahead-window:visible"
    )
    .locator("text=/Nigerian/i")
    .first();
  if (await suggestion.count()) {
    await suggestion.click({ timeout: 2_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(300);

  // Gender
  await page
    .locator("#Male0")
    .click({ timeout: 2_000 })
    .catch(() =>
      page.evaluate(() => {
        (document.getElementById("Male0") as HTMLInputElement)?.click();
      })
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);

  // Phone
  await page.locator("[name='PhoneNumber']").first().fill("08012345678").catch(() => undefined);
  await page.waitForTimeout(300);

  // Email
  await page
    .locator("input[type='email']")
    .first()
    .fill("test@example.com")
    .catch(() => undefined);
  await page.waitForTimeout(1_000);

  console.log("  Form filled.");

  // ---- Step 6: accept terms and click Continue ----
  currentPhase = "form-submit";
  console.log("\nStep 6: Accepting terms and clicking Continue...");

  const checkbox = page.locator("#acceptTermsAndCondition");
  const checked = await checkbox.isChecked().catch(() => false);
  if (!checked) {
    await checkbox
      .click({ timeout: 2_000 })
      .catch(() => checkbox.evaluate((el) => (el as HTMLInputElement).click()))
      .catch(() => undefined);
  }
  await page.waitForTimeout(500);

  const continueBtn = page
    .locator("button:has-text('Continue'), a:has-text('Continue')")
    .first();
  if (await continueBtn.count()) {
    await continueBtn.click({ timeout: 5_000 });
    console.log("  Clicked Continue.");
  } else {
    console.log("  No Continue button found.");
  }

  // ---- Step 7: wait for addons page ----
  currentPhase = "post-submit";
  console.log("\nStep 7: Waiting for post-submit navigation...");
  await page.waitForTimeout(10_000);
  console.log(`  Current URL: ${page.url()}`);

  // ---- Step 8: skip addons page ----
  currentPhase = "addons";
  if (page.url().includes("/addons")) {
    console.log("\nStep 8: On addons page, looking for Continue...");
    await page.waitForTimeout(3_000);

    // Try multiple selectors for the continue button
    const selectors = [
      "button:has-text('Continue')",
      "a:has-text('Continue')",
      "button:has-text('Skip')",
      ".btn-continue",
      "button.continue-btn",
      "[data-testid='continue-button']"
    ];

    let clicked = false;
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded().catch(() => undefined);
        await btn.click({ timeout: 5_000 }).catch(() => undefined);
        console.log(`  Clicked: ${sel}`);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // Try finding any visible button with text
      console.log("  Standard buttons not found. Checking page buttons...");
      const allButtons = await page.evaluate(() => {
        const btns = document.querySelectorAll("button, a.btn, a[role='button']");
        return Array.from(btns).map(b => ({
          text: (b.textContent ?? "").trim().slice(0, 50),
          tag: b.tagName,
          classes: b.className,
          visible: (b as HTMLElement).offsetParent !== null
        })).filter(b => b.visible && b.text);
      });
      console.log("  Visible buttons:", JSON.stringify(allButtons, null, 2));

      // Try clicking one that looks like "continue" or "proceed"
      for (const b of allButtons) {
        if (/continue|proceed|next|skip|no.?thanks/i.test(b.text)) {
          await page.locator(`${b.tag.toLowerCase()}:has-text('${b.text.slice(0, 20)}')`).first().click({ timeout: 5_000 }).catch(() => undefined);
          console.log(`  Clicked button: "${b.text}"`);
          clicked = true;
          break;
        }
      }
    }

    await page.waitForTimeout(8_000);
    console.log(`  URL after addons: ${page.url()}`);
  }

  // ---- Step 9: payment page ----
  currentPhase = "payment";
  console.log("\nStep 9: Checking for payment page...");
  console.log(`  Current URL: ${page.url()}`);

  // If still on addons, try direct navigation to payment
  if (page.url().includes("/addons")) {
    const bookingId = page.url().match(/booking\/(\d+)\//)?.[1];
    const reqKey = page.url().match(/reqKey=([^&]+)/)?.[1];
    if (bookingId && reqKey) {
      const payUrl = `https://www.wakanow.com/en-ng/booking/${bookingId}/payment?products=Flight&reqKey=${reqKey}`;
      console.log(`  Navigating directly to payment: ${payUrl}`);
      await page.goto(payUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(8_000);
    }
  }

  if (page.url().includes("/payment")) {
    console.log(`  On payment page: ${page.url()}`);
    await page.waitForTimeout(5_000);

    // Look for bank transfer option
    const bankTransferBtn = page.locator("text=/bank.?transfer|pay.?to.?bank|direct.?deposit/i").first();
    if (await bankTransferBtn.count()) {
      await bankTransferBtn.click({ timeout: 5_000 }).catch(() => undefined);
      console.log("  Clicked bank transfer option");
      await page.waitForTimeout(5_000);
    }

    // Capture all visible text on the payment page
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log("\n  === PAYMENT PAGE TEXT ===");
    console.log(pageText.slice(0, 5000));
    console.log("  === END PAYMENT PAGE TEXT ===\n");

    // Look for account details in page
    const accountDetails = await page.evaluate(() => {
      const text = document.body.innerText;
      const details: Record<string, string> = {};

      // Common patterns for account details
      const patterns = [
        /account\s*(?:number|no\.?)\s*[:\-]?\s*(\d{10,})/i,
        /bank\s*(?:name)?\s*[:\-]?\s*([A-Za-z\s]+(?:Bank|Plc))/i,
        /account\s*name\s*[:\-]?\s*([A-Za-z\s]+)/i,
        /sort\s*code\s*[:\-]?\s*(\d[\d\-]+)/i,
      ];

      for (const p of patterns) {
        const m = text.match(p);
        if (m) details[p.source.slice(0, 30)] = m[1].trim();
      }

      return { text: text.slice(0, 3000), details };
    });
    console.log("  Extracted account details:", JSON.stringify(accountDetails.details, null, 2));
  }

  // ---- Step 10: final wait ----
  currentPhase = "final";
  console.log("\nStep 10: Final wait...");
  await page.waitForTimeout(3_000);
  console.log(`  Final URL: ${page.url()}`);

  // ---- dump results ----
  await dumpAndExit(intercepted, browser);
}

async function dumpAndExit(intercepted: InterceptedCall[], browser: any) {
  console.log("\n" + "=".repeat(80));
  console.log("INTERCEPTED API CALLS SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total calls: ${intercepted.length}\n`);

  // Group by phase
  const phases = [...new Set(intercepted.map((c) => c.phase))];
  for (const phase of phases) {
    const calls = intercepted.filter((c) => c.phase === phase);
    console.log(`\n--- Phase: ${phase} (${calls.length} calls) ---\n`);
    for (const call of calls) {
      console.log(`  #${call.seq} ${call.method} ${call.url}`);
      console.log(`    Status: ${call.status}`);
      if (call.requestBody) {
        console.log(`    Request Body: ${call.requestBody.slice(0, 5000)}`);
      }
      console.log(`    Response (${call.responseBody.length} chars): ${call.responseBody.slice(0, 2000)}`);
      // Print interesting request headers (auth, content-type, etc)
      const interestingHeaders = ["authorization", "content-type", "x-requested-with", "x-xsrf-token"];
      for (const h of interestingHeaders) {
        if (call.requestHeaders[h]) {
          console.log(`    Header ${h}: ${call.requestHeaders[h]}`);
        }
      }
      console.log();
    }
  }

  // Also dump JSON-only calls as a structured summary for easy parsing
  const jsonCalls = intercepted.filter((c) =>
    (c.responseHeaders["content-type"] ?? "").includes("json")
  );
  if (jsonCalls.length) {
    console.log("\n" + "=".repeat(80));
    console.log("JSON API CALLS ONLY (most likely the ones we need)");
    console.log("=".repeat(80));
    for (const call of jsonCalls) {
      console.log(`\n#${call.seq} [${call.phase}] ${call.method} ${call.url}`);
      console.log(`  Status: ${call.status}`);
      if (call.requestBody) console.log(`  Req: ${call.requestBody.slice(0, 1000)}`);
      console.log(`  Res: ${call.responseBody.slice(0, 1000)}`);
    }
  }

  // Write full intercepted data to file for analysis
  const fs = await import("fs");
  fs.writeFileSync("intercept-output.json", JSON.stringify(intercepted, null, 2));
  console.log("\nFull data written to intercept-output.json");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
