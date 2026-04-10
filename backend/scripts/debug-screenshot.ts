/**
 * Fill the form and take screenshots at each step to visually debug
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 1 });
  const browser = await chromium.launch({ headless: true, args: ["--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    locale: "en-NG", timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  await page.goto(search.results[0].deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  await page.screenshot({ path: "/tmp/skypadi-1-before-fill.png", fullPage: true });
  console.log("Screenshot 1: before fill → /tmp/skypadi-1-before-fill.png");

  // Fill form
  await page.locator("select").first().selectOption({ label: "Mr" });
  await page.waitForTimeout(200);
  await page.locator("[name='booking_lastname']").first().fill("Doe");
  await page.locator("[name='booking_firstname']").first().fill("John");
  await page.locator("[name='booking_middlename']").first().fill("").catch(() => {});

  // DOB
  await page.locator("input[placeholder='yyyy-mm-dd']").first().click({ timeout: 3_000 });
  await page.waitForTimeout(1000);
  const dpSelects = page.locator("ngb-datepicker select");
  await dpSelects.nth(1).selectOption("1990");
  await page.waitForTimeout(300);
  await dpSelects.nth(0).selectOption("6");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const dayCells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
    for (const cell of dayCells) {
      if ((cell.textContent ?? "").trim() === "15" && !cell.classList.contains("ngb-dp-day--outside")) {
        (cell as HTMLElement).click(); return;
      }
    }
  });
  await page.waitForTimeout(500);

  // Gender
  await page.locator("#Male0").click({ timeout: 3000 }).catch(() => {
    console.log("Male0 click failed, trying evaluate...");
    return page.evaluate(() => (document.getElementById("Male0") as any)?.click());
  });

  // Phone & Email
  await page.locator("[name='PhoneNumber']").first().fill("08012345678");
  await page.locator("input[type='email']").first().fill("test@example.com");
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "/tmp/skypadi-2-after-fill.png", fullPage: true });
  console.log("Screenshot 2: after fill → /tmp/skypadi-2-after-fill.png");

  // Check invalid fields
  const invalids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input.ng-invalid, select.ng-invalid, ng-select.ng-invalid"))
      .map(el => ({
        tag: el.tagName,
        fc: el.getAttribute("formcontrolname"),
        name: el.getAttribute("name"),
        class: el.className.slice(0, 60)
      }));
  });
  console.log("Invalid fields after fill:", JSON.stringify(invalids, null, 2));

  // Accept terms
  const cb = page.locator("#acceptTermsAndCondition");
  if (!(await cb.isChecked())) await cb.click();
  await page.waitForTimeout(500);

  await page.screenshot({ path: "/tmp/skypadi-3-before-submit.png", fullPage: true });
  console.log("Screenshot 3: before submit → /tmp/skypadi-3-before-submit.png");

  // Click Continue
  await page.locator("button:has-text('Continue'), a:has-text('Continue')").first().click({ timeout: 5000 });
  await page.waitForTimeout(15000);

  await page.screenshot({ path: "/tmp/skypadi-4-after-submit.png", fullPage: true });
  console.log("Screenshot 4: after submit → /tmp/skypadi-4-after-submit.png");
  console.log("URL:", page.url());

  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
