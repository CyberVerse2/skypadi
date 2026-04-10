/**
 * Debug script: runs the booking form filling in a VISIBLE browser
 * to see what's going wrong with the form submission
 */
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  console.log("Searching...");
  const search = await searchFlightsApi({ origin: "Lagos", destination: "Abuja", departureDate: "2026-04-15", maxResults: 3 });
  const flight = search.results[0];
  console.log(`Flight: ${flight.airline} ${flight.departureTime} ${flight.priceText}`);
  console.log(`Deeplink: ${flight.deeplink}`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  // Navigate to listings
  console.log("\nLoading listings...");
  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);

  // Click Book Now
  console.log("Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5000 });

  // Wait for customer-info
  console.log("Waiting for customer-info...");
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Fill form
  console.log("Filling form...");

  // Title
  const titleSelect = page.locator("select").first();
  await titleSelect.selectOption({ label: "Mr" });
  console.log(`  Title: ${await titleSelect.inputValue()}`);
  await page.waitForTimeout(300);

  // Last Name
  await page.locator("[name='booking_lastname']").first().fill("Doe");
  console.log(`  Last Name: ${await page.locator("[name='booking_lastname']").first().inputValue()}`);

  // First Name
  await page.locator("[name='booking_firstname']").first().fill("John");
  console.log(`  First Name: ${await page.locator("[name='booking_firstname']").first().inputValue()}`);

  // Middle Name
  await page.locator("[name='booking_middlename']").first().fill("").catch(() => console.log("  Middle name field not found"));

  // DOB
  console.log("  Opening DOB picker...");
  await page.locator("input[placeholder='yyyy-mm-dd']").first().click({ timeout: 3_000 });
  await page.waitForTimeout(1000);

  // Check what selects exist in datepicker
  const dpSelects = page.locator("ngb-datepicker select");
  const dpSelectCount = await dpSelects.count();
  console.log(`  Found ${dpSelectCount} selects in datepicker`);
  for (let i = 0; i < dpSelectCount; i++) {
    const label = await dpSelects.nth(i).getAttribute("aria-label") ?? "no-label";
    const title = await dpSelects.nth(i).getAttribute("title") ?? "no-title";
    const options = await dpSelects.nth(i).locator("option").allTextContents();
    console.log(`    Select ${i}: aria-label="${label}" title="${title}" options=[${options.slice(0, 5).join(", ")}...]`);
  }

  // Try selectOption for year
  try {
    await dpSelects.nth(1).selectOption("1990"); // year is usually second
    console.log("  Selected year 1990");
  } catch (e: any) {
    console.log(`  Year selectOption failed: ${e.message.slice(0, 100)}`);
  }
  await page.waitForTimeout(300);

  try {
    await dpSelects.nth(0).selectOption("6"); // month is usually first
    console.log("  Selected month 6");
  } catch (e: any) {
    console.log(`  Month selectOption failed: ${e.message.slice(0, 100)}`);
  }
  await page.waitForTimeout(500);

  // Click day 15
  const clicked = await page.evaluate(() => {
    const dayCells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
    for (const cell of dayCells) {
      if ((cell.textContent ?? "").trim() === "15" && !cell.classList.contains("ngb-dp-day--outside")) {
        (cell as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  console.log(`  Clicked day 15: ${clicked}`);
  await page.waitForTimeout(500);

  const dobVal = await page.locator("input[placeholder='yyyy-mm-dd']").first().inputValue();
  console.log(`  DOB value: "${dobVal}"`);

  // Nationality
  console.log("  Setting nationality...");
  const natInput = page.locator("input[formcontrolname*='ationality'], input[formcontrolname*='nationality']").first();
  const natCount = await natInput.count();
  console.log(`  Nationality input found: ${natCount}`);
  if (natCount) {
    const attrs = await natInput.evaluate(el => ({
      type: el.getAttribute("type"),
      fc: el.getAttribute("formcontrolname"),
      placeholder: el.getAttribute("placeholder"),
      id: el.id
    }));
    console.log(`  Nationality input attrs: ${JSON.stringify(attrs)}`);
    await natInput.click();
    await natInput.clear();
    await natInput.pressSequentially("Nigeria", { delay: 50 });
    await page.waitForTimeout(2000);

    // Debug: check what dropdowns are visible
    const dropdowns = await page.evaluate(() => {
      const els = document.querySelectorAll("ngb-typeahead-window, [role='listbox']");
      return Array.from(els).map(el => ({
        tag: el.tagName,
        visible: (el as HTMLElement).offsetParent !== null,
        text: (el as HTMLElement).innerText?.slice(0, 200),
        childCount: el.children.length
      }));
    });
    console.log(`  Dropdowns found: ${JSON.stringify(dropdowns, null, 2)}`);

    // Try clicking first visible dropdown item
    const anyItem = page.locator("ngb-typeahead-window button, ngb-typeahead-window .dropdown-item").first();
    const itemCount = await anyItem.count();
    console.log(`  Dropdown items found: ${itemCount}`);
    if (itemCount) {
      const itemText = await anyItem.textContent();
      console.log(`  First item text: "${itemText}"`);
      await anyItem.click();
      console.log("  Clicked suggestion");
    } else {
      // Try keyboard
      await natInput.press("ArrowDown");
      await page.waitForTimeout(200);
      await natInput.press("Enter");
      console.log("  Used keyboard to select");
    }
  }
  await page.waitForTimeout(500);
  // Check nationality value after selection
  const natVal = await natInput.inputValue().catch(() => "");
  console.log(`  Nationality value after: "${natVal}"`);

  // Gender
  console.log("  Setting gender...");
  const maleRadio = page.locator("#Male0");
  if (await maleRadio.count()) {
    await maleRadio.click();
    console.log(`  Male radio checked: ${await maleRadio.isChecked()}`);
  } else {
    console.log("  Male radio not found, trying evaluate...");
    await page.evaluate(() => (document.getElementById("Male0") as any)?.click());
  }

  // Phone
  await page.locator("[name='PhoneNumber']").first().fill("08012345678");
  console.log(`  Phone: ${await page.locator("[name='PhoneNumber']").first().inputValue()}`);

  // Email
  await page.locator("input[type='email']").first().fill("test@example.com");
  console.log(`  Email: ${await page.locator("input[type='email']").first().inputValue()}`);

  await page.waitForTimeout(1000);

  // Check invalid fields
  const invalidFields = await page.evaluate(() => {
    const invalids = document.querySelectorAll(".ng-invalid");
    return Array.from(invalids).map(el => ({
      tag: el.tagName,
      name: el.getAttribute("name") || el.getAttribute("formcontrolname") || el.id || "",
      class: el.className.slice(0, 80)
    })).filter(e => e.tag === "INPUT" || e.tag === "SELECT");
  });
  console.log(`\nInvalid fields: ${JSON.stringify(invalidFields, null, 2)}`);

  // Check terms
  const cb = page.locator("#acceptTermsAndCondition");
  const isChecked = await cb.isChecked().catch(() => false);
  console.log(`\nTerms checked: ${isChecked}`);
  if (!isChecked) {
    await cb.click();
    console.log(`Terms now checked: ${await cb.isChecked()}`);
  }

  console.log("\n=== PAUSED === Check the browser window. Press Ctrl+C to exit.");
  await page.waitForTimeout(300_000); // 5 min to inspect
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
