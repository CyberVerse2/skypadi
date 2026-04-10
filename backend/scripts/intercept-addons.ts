/**
 * Intercept API calls when clicking "Pay Now" on the addons page.
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { bookFlightApi } from "../src/services/wakanow/api-book.js";

async function main() {
  console.log("Step 1: Searching...");
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 3 });
  const flight = search.results[0];
  console.log(`  Using: ${flight.airline} ${flight.departureTime} ${flight.priceText}`);

  console.log("\nStep 2: Booking via API...");
  const booking = await bookFlightApi({
    searchKey: flight.searchKey!,
    flightId: flight.flightId!,
    passenger: { title: "Mr", firstName: "John", lastName: "Doe", dateOfBirth: "1990-06-15", nationality: "Nigerian", gender: "Male", phone: "08012345678", email: "test@example.com" }
  });
  console.log(`  BookingId: ${booking.bookingId}`);

  console.log("\nStep 3: Opening addons page in browser...");
  const browser = await chromium.launch({ headless: false, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({ locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" });
  const page = await context.newPage();

  // Intercept API calls
  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();
    if (!url.includes("wakanow.com") || /\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(url)) return;
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;
    const ct = res.headers()["content-type"] ?? "";
    const isJson = ct.includes("json");
    let body = "";
    try { body = await res.text(); } catch { body = "<unreadable>"; }
    console.log(`  [API] ${req.method()} ${url.slice(0, 150)} -> ${res.status()}${isJson ? " [JSON]" : ""}`);
    if (req.postData()) console.log(`    REQ: ${req.postData()!.slice(0, 500)}`);
    if (isJson) console.log(`    RES: ${body.slice(0, 800)}`);
  });

  const addonsUrl = `https://www.wakanow.com/en-ng/booking/${booking.bookingId}/addons?products=Flight&reqKey=${flight.searchKey}`;
  console.log(`  URL: ${addonsUrl}`);
  await page.goto(addonsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(10_000);
  console.log(`  Page loaded: ${page.url()}`);

  // Scroll down to find the button
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // Find Pay Now button
  const paySelectors = [
    "text=/pay\\s*now/i",
    "text=/proceed.*payment/i",
    "text=/continue.*payment/i",
    "text=/make.*payment/i",
    "button:has-text('Pay')",
    "a:has-text('Pay')"
  ];

  let clicked = false;
  for (const sel of paySelectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      const text = await el.textContent();
      console.log(`\nStep 4: Found button "${text?.trim()}" — clicking...`);
      await el.click({ timeout: 5000 });
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // List all buttons for debugging
    const btns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button, a.btn, a[role=button], input[type=submit], .btn"))
        .map(e => ({ text: (e.textContent || "").trim().slice(0, 80), tag: e.tagName, visible: (e as HTMLElement).offsetParent !== null }))
        .filter(e => e.visible && e.text);
    });
    console.log("\nNo Pay Now button found. All visible buttons:");
    btns.forEach((b, i) => console.log(`  ${i}: [${b.tag}] ${b.text}`));
    await browser.close();
    return;
  }

  // Wait for navigation and capture API calls
  console.log("\nStep 5: Waiting for payment page...");
  await page.waitForTimeout(15_000);
  console.log(`  URL: ${page.url()}`);

  // If on payment page, look for bank transfer
  if (page.url().includes("/payment")) {
    console.log("\nStep 6: On payment page, looking for bank transfer...");
    const bankBtn = page.locator("text=/bank.?transfer|pay.?to.?bank/i").first();
    if (await bankBtn.count()) {
      console.log("  Clicking bank transfer...");
      await bankBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log("\n=== PAYMENT PAGE TEXT ===");
    console.log(pageText.slice(0, 5000));
    console.log("=== END ===");
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
