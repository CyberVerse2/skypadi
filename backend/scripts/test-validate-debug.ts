import "dotenv/config";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { chromium } from "playwright";

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

  let selectData: any = null;
  let angularValidateBody: string | null = null;

  // Capture Select response AND Angular's Validate request
  page.on("response", async (res) => {
    if (res.url().includes("/flights/Select/") && res.status() === 200) {
      try { selectData = await res.json(); } catch {}
    }
  });
  page.on("request", (req) => {
    if (req.url().includes("/Booking/Validate") && req.method() === "POST") {
      angularValidateBody = req.postData();
      console.log(`\n>>> Angular Validate body captured (${angularValidateBody?.length} chars)`);
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

  // Test 1: Can we make a simple GET to booking.wakanow.com from page.evaluate?
  console.log("\n--- Test 1: Simple GET to booking API ---");
  const test1 = await page.evaluate(async (id) => {
    try {
      const res = await fetch(`https://booking.wakanow.com/api/booking/BookingConfirmation/Get/${id}`, {
        credentials: "include",
        headers: { "Accept": "application/json, text/plain, */*" }
      });
      return { status: res.status, ok: res.ok, statusText: res.statusText };
    } catch (e: any) {
      return { error: e.message };
    }
  }, bookingId);
  console.log("Result:", JSON.stringify(test1));

  // Test 2: Our constructed Validate body
  const bookingData = selectData?.SelectData;
  console.log(`\nSelectData captured: ${!!bookingData} (${bookingData?.length} chars)`);

  const ourBody = {
    PassengerDetails: [{
      PassengerType: "Adult", Email: "test@example.com", PhoneNumber: "+2348012345678",
      Title: "Mr", FirstName: "Test", LastName: "User", MiddleName: "", Gender: "Male",
      DateOfBirth: "15 January, 1990", Age: 36,
      ExpiryDate: "", PassportNumber: "", PassportIssuingAuthority: "", PassportIssueCountryCode: "",
      PassengerReferenceNumber: "", TimeOfTravel: "", CountryCode: "NG", Country: "Nigeria",
      Address: "", City: "", SelectedBaggages: [], SelectedSeats: [], WakaPointId: ""
    }],
    BookingItemModels: [{ ProductType: "Flight", BookingData: bookingData }]
  };

  // Test 3: Our Validate call
  console.log("\n--- Test 3: Our Validate call ---");
  const test3 = await page.evaluate(async (body) => {
    try {
      const res = await fetch("https://booking.wakanow.com/api/booking/Booking/Validate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*" },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 500), headers: Object.fromEntries(res.headers.entries()) };
    } catch (e: any) {
      return { error: e.message };
    }
  }, ourBody);
  console.log("Our Validate result:", JSON.stringify(test3, null, 2));

  // Test 4: Now let Angular do it — fill form and click Continue
  console.log("\n--- Test 4: Let Angular handle Validate ---");
  await page.locator("select").first().selectOption({ label: "Mr" });
  await page.locator("[name='booking_lastname']").first().fill("User");
  await page.locator("[name='booking_firstname']").first().fill("Test");

  // DOB
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

  // Compare bodies
  if (angularValidateBody) {
    const angular = JSON.parse(angularValidateBody);
    console.log("\n--- Comparing bodies ---");
    console.log(`Angular PassengerDetails[0] keys: ${Object.keys(angular.PassengerDetails[0]).sort().join(", ")}`);
    console.log(`Our PassengerDetails[0] keys: ${Object.keys(ourBody.PassengerDetails[0]).sort().join(", ")}`);

    // Diff
    for (const key of Object.keys(angular.PassengerDetails[0])) {
      const a = angular.PassengerDetails[0][key];
      const o = (ourBody.PassengerDetails[0] as any)[key];
      if (JSON.stringify(a) !== JSON.stringify(o)) {
        console.log(`  DIFF ${key}: angular=${JSON.stringify(a)} vs ours=${JSON.stringify(o)}`);
      }
    }
    // Check for missing keys
    for (const key of Object.keys(angular.PassengerDetails[0])) {
      if (!(key in ourBody.PassengerDetails[0])) {
        console.log(`  MISSING in ours: ${key} = ${JSON.stringify(angular.PassengerDetails[0][key])}`);
      }
    }

    // Compare BookingData
    const angularBD = angular.BookingItemModels[0].BookingData;
    console.log(`\nBookingData match: ${angularBD === bookingData}`);
    if (angularBD !== bookingData) {
      console.log(`  Angular BD length: ${angularBD.length}, Ours: ${bookingData.length}`);
      console.log(`  Angular BD start: ${angularBD.slice(0, 50)}`);
      console.log(`  Our BD start: ${bookingData.slice(0, 50)}`);
    }
  } else {
    console.log("Angular Validate body NOT captured!");
  }

  await browser.close();
}

main().catch(console.error);
