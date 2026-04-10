/**
 * Test ONLY the form filling — no submission.
 * Opens a visible browser so you can see the datepicker interaction.
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  console.log("Searching...");
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 1 });
  const flight = search.results[0];
  console.log(`Flight: ${flight.airline} ${flight.departureTime} ${flight.priceText}`);

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

  // Navigate to listings
  console.log("\n1. Loading listings...");
  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);

  // Click Book Now
  console.log("2. Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });

  // Wait for customer-info
  console.log("3. Waiting for customer-info...");
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
  await page.waitForTimeout(5000);
  console.log(`   URL: ${page.url()}`);

  // === FILL FORM ===
  console.log("\n4. Filling form...");

  // Title
  await page.locator("select").first().selectOption({ label: "Mr" });
  console.log("   ✓ Title: Mr");

  // Names
  await page.locator("[name='booking_lastname']").first().fill("Chinaza");
  await page.locator("[name='booking_firstname']").first().fill("Celestine");
  await page.locator("[name='booking_middlename']").first().fill("").catch(() => {});
  console.log("   ✓ Names filled");

  // === DATE OF BIRTH ===
  console.log("\n5. Date of birth...");
  const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();

  // Click to open datepicker
  await dobInput.click({ timeout: 3000 });
  await page.waitForTimeout(1000);

  // Check what's in the datepicker
  const dpSelects = page.locator("ngb-datepicker select");
  const dpCount = await dpSelects.count();
  console.log(`   Found ${dpCount} selects in datepicker`);

  if (dpCount >= 2) {
    // List options for each select
    for (let i = 0; i < dpCount; i++) {
      const label = await dpSelects.nth(i).getAttribute("aria-label") ?? "?";
      const currentVal = await dpSelects.nth(i).inputValue();
      const optionCount = await dpSelects.nth(i).locator("option").count();
      console.log(`   Select ${i}: label="${label}" current="${currentVal}" options=${optionCount}`);
    }

    // Select year (usually index 1)
    console.log("   Selecting year 1995...");
    await dpSelects.nth(1).selectOption("1995");
    await page.waitForTimeout(500);
    console.log(`   Year value: ${await dpSelects.nth(1).inputValue()}`);

    // Select month (usually index 0) — value is 1-based
    console.log("   Selecting month 3 (March)...");
    await dpSelects.nth(0).selectOption("3");
    await page.waitForTimeout(500);
    console.log(`   Month value: ${await dpSelects.nth(0).inputValue()}`);

    // Click day 20
    console.log("   Clicking day 20...");
    const clicked = await page.evaluate(() => {
      const cells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
      for (const cell of cells) {
        const text = (cell.textContent ?? "").trim();
        if (text === "20" && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click();
          return `clicked "${text}"`;
        }
      }
      // List what days are visible
      const visible = Array.from(cells).map(c => (c.textContent ?? "").trim()).join(",");
      return `day 20 not found. visible: ${visible}`;
    });
    console.log(`   ${clicked}`);
    await page.waitForTimeout(500);
  } else {
    console.log("   ⚠ Datepicker selects not found!");
    // Try clicking the calendar button instead
    const calBtn = page.locator("button:has(.fa-calendar)").first();
    if (await calBtn.count()) {
      console.log("   Trying calendar button...");
      await calBtn.click();
      await page.waitForTimeout(1000);
      const dpCount2 = await dpSelects.count();
      console.log(`   After calendar click: ${dpCount2} selects`);
    }
  }

  const dobVal = await dobInput.inputValue();
  console.log(`   DOB value: "${dobVal}"`);

  // === GENDER ===
  console.log("\n6. Gender...");
  const maleRadio = page.locator("#Male0");
  const maleDisabled = await maleRadio.evaluate(el => (el as HTMLInputElement).disabled).catch(() => true);
  console.log(`   Male radio disabled: ${maleDisabled}`);
  if (!maleDisabled) {
    await maleRadio.click();
    console.log("   ✓ Clicked Male");
  } else {
    console.log("   ⚠ Male is disabled — nationality might not be set");
  }

  // Phone & Email
  await page.locator("[name='PhoneNumber']").first().fill("08134278512");
  await page.locator("input[type='email']").first().fill("coinswagapp@gmail.com");
  console.log("\n7. ✓ Phone & Email filled");

  // Final form state
  const state = await page.evaluate(() => {
    return {
      title: (document.querySelector("select") as HTMLSelectElement)?.value ?? "",
      lastName: (document.querySelector("[name='booking_lastname']") as HTMLInputElement)?.value ?? "",
      firstName: (document.querySelector("[name='booking_firstname']") as HTMLInputElement)?.value ?? "",
      dob: (document.querySelector("input[placeholder='yyyy-mm-dd']") as HTMLInputElement)?.value ?? "",
      gender: (document.getElementById("Male0") as HTMLInputElement)?.checked ? "Male" :
              (document.getElementById("Female0") as HTMLInputElement)?.checked ? "Female" : "none",
      phone: (document.querySelector("[name='PhoneNumber']") as HTMLInputElement)?.value ?? "",
      email: (document.querySelector("input[type='email']") as HTMLInputElement)?.value ?? "",
    };
  });
  console.log(`\n=== FORM STATE ===`);
  console.log(JSON.stringify(state, null, 2));

  // Screenshot
  await page.screenshot({ path: "/tmp/skypadi-form-test.png", fullPage: true });
  console.log(`\nScreenshot → /tmp/skypadi-form-test.png`);

  // Keep browser open for inspection
  console.log("\n=== Browser open for inspection. Press Ctrl+C to close. ===");
  await page.waitForTimeout(120_000);
  await browser.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
