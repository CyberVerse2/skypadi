import "dotenv/config";
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { writeFileSync } from "fs";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: { connect:()=>{}, sendMessage:()=>{}, onMessage:{addListener:()=>{}} }, loadTimes:()=>({}), csi:()=>({}) };
`;

const passenger = { title: "Mr", firstName: "Test", lastName: "User", dateOfBirth: "1990-01-15", gender: "Male", phone: "08012345678", email: "test@example.com" };

async function main() {
  // Search
  console.log("Searching...");
  const result = await searchFlightsApi({ origin: "Enugu", destination: "Lagos", departureDate: "2026-04-18", maxResults: 5 });
  const flight = result.results[0];
  console.log(`Flight: ${flight.airline} ${flight.priceText}, key=${flight.searchKey}`);

  // Browser - capture Select response + Validate request
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({ locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: USER_AGENT, viewport: { width: 1440, height: 900 } });
  await context.addInitScript(STEALTH_SCRIPT);
  const page = await context.newPage();

  // Capture Select response and Validate request
  let selectResponse: any = null;
  let validateBody: any = null;

  page.on("request", async (req) => {
    const url = req.url();
    if (url.includes("/Booking/Validate")) {
      const body = req.postData();
      if (body) {
        validateBody = JSON.parse(body);
        writeFileSync("/tmp/validate-body.json", JSON.stringify(validateBody, null, 2));
        console.log(">>> Saved Validate body to /tmp/validate-body.json");
      }
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/flights/Select/") && res.status() === 200) {
      try {
        selectResponse = await res.json();
        writeFileSync("/tmp/select-response.json", JSON.stringify(selectResponse, null, 2));
        console.log(">>> Saved Select response to /tmp/select-response.json");
      } catch {}
    }
  });

  // Load listings
  console.log("Loading listings...");
  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const cookieBtn = page.locator("text=/yes,?\\s*i\\s*agree/i").first();
  if (await cookieBtn.isVisible({ timeout: 5_000 }).catch(() => false)) await cookieBtn.click();
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 120_000 });

  // Click Book Now
  console.log("Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("button.box-button:not(.d-md-none)").first().click();
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
  const bookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
  console.log(`BookingId: ${bookingId}`);

  // Fill form
  console.log("Filling form...");
  await page.waitForTimeout(3_000);
  await page.locator("select").first().selectOption({ label: passenger.title });
  await page.locator("[name='booking_lastname']").first().fill(passenger.lastName);
  await page.locator("[name='booking_firstname']").first().fill(passenger.firstName);

  const dobContainer = page.locator("input[placeholder='yyyy-mm-dd']").first().locator("..");
  const calBtn = dobContainer.locator("button:has(.fa-calendar), button.btn-outline-dark").first();
  if (await calBtn.count()) await calBtn.click();
  await page.waitForTimeout(1_500);
  const dpSelects = page.locator("ngb-datepicker select");
  if (await dpSelects.count() >= 2) {
    await dpSelects.nth(1).selectOption("1990");
    await page.waitForTimeout(500);
    await dpSelects.nth(0).selectOption("1");
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      for (const cell of document.querySelectorAll("ngb-datepicker div.ngb-dp-day")) {
        if ((cell.textContent ?? "").trim() === "15" && !cell.classList.contains("ngb-dp-day--outside")) { (cell as HTMLElement).click(); return; }
      }
    });
  }
  await page.waitForTimeout(500);
  await page.locator("#Male0").click().catch(async () => { await page.evaluate(() => (document.querySelector("#Male0") as HTMLElement)?.click()); });
  await page.locator("[name='PhoneNumber']").first().fill(passenger.phone);
  await page.locator("input[type='email']").first().fill(passenger.email);
  await page.waitForTimeout(1_000);

  const cb = page.locator("#acceptTermsAndCondition");
  if (!(await cb.isChecked().catch(() => false))) await cb.click().catch(() => cb.evaluate(el => (el as any).click()));
  await page.waitForTimeout(500);

  // Submit - this triggers the Validate API
  console.log("Submitting...");
  await page.locator("button:has-text('Continue')").first().click();
  await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 60_000 });
  console.log(`After submit: ${page.url()}`);

  // Wait for validate body to be captured
  await page.waitForTimeout(3_000);

  // Now decode BookingData
  if (validateBody) {
    const bd = validateBody.BookingItemModels[0].BookingData;
    console.log(`\nBookingData length: ${bd.length}`);

    // Decode in Node
    const raw = Buffer.from(bd, "base64");
    console.log(`Raw bytes: ${raw.length}, header: ${raw.subarray(0, 4).toString("hex")}`);

    const { gunzipSync } = await import("zlib");
    const decompressed = gunzipSync(raw.subarray(4));
    const inner = JSON.parse(decompressed.toString("utf-8"));
    writeFileSync("/tmp/booking-data-decoded.json", JSON.stringify(inner, null, 2));
    console.log(">>> Saved decoded BookingData to /tmp/booking-data-decoded.json");
    console.log(`Decoded keys: ${Object.keys(inner)}`);
    console.log(JSON.stringify(inner, null, 2).slice(0, 2000));
  }

  // Also compare with Select response
  if (selectResponse) {
    console.log(`\nSelect response keys: ${Object.keys(selectResponse)}`);
  }

  await browser.close();
  console.log("\nDONE");
}

main().catch(console.error);
