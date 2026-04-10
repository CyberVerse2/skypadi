/**
 * Create a booking via API, then navigate to payment page to capture bank details.
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { bookFlightApi } from "../src/services/wakanow/api-book.js";

async function main() {
  const headed = process.argv.includes("--headed");

  // Step 1: Search
  console.log("Step 1: Searching flights...");
  const search = await searchFlightsApi({
    origin: "Lagos",
    destination: "Abuja",
    departureDate: "2026-04-16",
    maxResults: 5
  });
  console.log(`  Found ${search.resultCount} flights`);
  const flight = search.results[0];
  console.log(`  Using: ${flight.airline} ${flight.departureTime} ${flight.priceText}`);

  // Step 2: Book via API
  console.log("\nStep 2: Booking via API...");
  const booking = await bookFlightApi({
    searchKey: flight.searchKey!,
    flightId: flight.flightId!,
    passenger: {
      title: "Mr",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-06-15",
      nationality: "Nigerian",
      gender: "Male",
      phone: "08012345678",
      email: "test@example.com"
    }
  });
  console.log(`  Booking ID: ${booking.bookingId}`);
  console.log(`  Payment URL: ${booking.paymentUrl}`);

  // Step 3: Open payment page in browser
  console.log("\nStep 3: Opening payment page in browser...");
  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  // Intercept API calls
  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();
    if (!url.includes("wakanow.com") || /\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(url)) return;
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;

    let body = "";
    try { body = await res.text(); } catch { body = "<unreadable>"; }
    const ct = res.headers()["content-type"] ?? "";
    const isJson = ct.includes("json");
    console.log(`  [API] ${req.method()} ${url.slice(0, 120)} -> ${res.status()} ${isJson ? "[JSON]" : ""}`);
    if (req.postData()) console.log(`    REQ: ${req.postData()!.slice(0, 500)}`);
    if (isJson) console.log(`    RES: ${body.slice(0, 1000)}`);
  });

  await page.goto(booking.paymentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);
  console.log(`  Page URL: ${page.url()}`);

  // Capture full page text
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
  console.log("\n=== PAYMENT PAGE TEXT ===");
  console.log(pageText.slice(0, 8000));
  console.log("=== END ===\n");

  // Try clicking "Bank Transfer" or "Pay to Bank" if visible
  const bankOptions = [
    "text=/bank.?transfer/i",
    "text=/pay.?to.?bank/i",
    "text=/direct.?deposit/i",
    "text=/pay.?via.?bank/i",
    "text=/bank.?payment/i"
  ];
  for (const sel of bankOptions) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      console.log(`Clicking: ${sel}`);
      await el.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);

      const afterText = await page.evaluate(() => document.body.innerText).catch(() => "");
      console.log("\n=== AFTER BANK TRANSFER CLICK ===");
      console.log(afterText.slice(0, 8000));
      console.log("=== END ===\n");
      break;
    }
  }

  // Look for payment method buttons/tabs
  const paymentMethods = await page.evaluate(() => {
    const elements = document.querySelectorAll("button, a, div[role='tab'], label, .payment-method, .pay-option");
    return Array.from(elements)
      .map(e => ({
        text: (e.textContent ?? "").trim().slice(0, 80),
        tag: e.tagName,
        classes: e.className
      }))
      .filter(e => e.text && /pay|bank|card|transfer|ussd|wallet/i.test(e.text));
  });
  if (paymentMethods.length) {
    console.log("Payment method elements found:");
    console.log(JSON.stringify(paymentMethods, null, 2));
  }

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
