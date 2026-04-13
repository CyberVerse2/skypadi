import "dotenv/config";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: { connect:()=>{}, sendMessage:()=>{}, onMessage:{addListener:()=>{}} }, loadTimes:()=>({}), csi:()=>({}) };
`;

async function main() {
  const result = await searchFlightsApi({ origin: "Enugu", destination: "Lagos", departureDate: "2026-04-18", maxResults: 5 });
  const flight = result.results[0];
  console.log(`Flight: ${flight.airline} ${flight.priceText}`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    locale: "en-NG", timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  await context.addInitScript(STEALTH);
  const page = await context.newPage();

  // Only capture Angular's Validate request — don't make our own
  const validateBodies: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/Booking/Validate") && req.method() === "POST") {
      const body = req.postData();
      if (body) validateBodies.push(body);
    }
  });

  // Load page
  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const cookieBtn = page.locator("text=/yes,?\\s*i\\s*agree/i").first();
  if (await cookieBtn.isVisible({ timeout: 5_000 }).catch(() => false)) await cookieBtn.click();
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 120_000 });

  // Click Book Now
  await page.locator("div.flight-fare-detail-wrap").first().locator("button.box-button:not(.d-md-none)").first().click();
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
  const bookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
  console.log(`BookingId: ${bookingId}`);
  await page.waitForTimeout(3_000);

  // Fill form — let Angular handle everything
  await page.locator("select").first().selectOption({ label: "Mr" });
  await page.locator("[name='booking_lastname']").first().fill("User");
  await page.locator("[name='booking_firstname']").first().fill("Test");

  const calBtn = page.locator("input[placeholder='yyyy-mm-dd']").first().locator("..").locator("button:has(.fa-calendar), button.btn-outline-dark").first();
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
  await page.locator("#Male0").click().catch(() => page.evaluate(() => (document.querySelector("#Male0") as HTMLElement)?.click()));
  await page.locator("[name='PhoneNumber']").first().fill("08012345678");
  await page.locator("input[type='email']").first().fill("test@example.com");
  await page.waitForTimeout(1_000);

  const cb = page.locator("#acceptTermsAndCondition");
  if (!(await cb.isChecked().catch(() => false))) await cb.click().catch(() => cb.evaluate(el => (el as any).click()));
  await page.waitForTimeout(500);

  // Click Continue — Angular sends Validate
  await page.locator("button:has-text('Continue')").first().click();
  await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 60_000 }).catch(() => {});
  console.log(`After Continue: ${page.url()}`);
  await page.waitForTimeout(2_000);

  // Save the Angular Validate body
  if (validateBodies.length > 0) {
    const body = JSON.parse(validateBodies[validateBodies.length - 1]);
    writeFileSync("/tmp/angular-validate-body.json", JSON.stringify(body, null, 2));
    console.log(`\nSaved Angular Validate body to /tmp/angular-validate-body.json`);
    console.log(`Body length: ${validateBodies[validateBodies.length - 1].length}`);

    // Print the full body structure (without BookingData)
    const display = JSON.parse(JSON.stringify(body));
    if (display.BookingItemModels?.[0]?.BookingData) {
      display.BookingItemModels[0].BookingData = `[${display.BookingItemModels[0].BookingData.length} chars]`;
    }
    console.log(JSON.stringify(display, null, 2));
  } else {
    console.log("No Validate body captured!");
  }

  await browser.close();
}

main().catch(console.error);
