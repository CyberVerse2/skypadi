import "dotenv/config";
import { chromium } from "playwright";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', {
    get: () => { const p = [{name:'Chrome PDF Plugin',filename:'internal-pdf-viewer',description:'PDF'}]; p.refresh=()=>{}; return p; }
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: { connect:()=>{}, sendMessage:()=>{}, onMessage:{addListener:()=>{}} }, loadTimes:()=>({}), csi:()=>({}) };
`;

const passenger = {
  title: "Mr", firstName: "Test", lastName: "User",
  dateOfBirth: "1990-01-15", gender: "Male",
  phone: "08012345678", email: "test@example.com"
};

async function main() {
  // Step 1: Search via existing API
  console.log(">>> Searching flights...");
  const searchResult = await searchFlightsApi({
    origin: "Enugu", destination: "Lagos", departureDate: "2026-04-18", maxResults: 5
  });
  const flight = searchResult.results[0];
  const searchKey = flight.searchKey!;
  console.log(`Found ${searchResult.resultCount} flights. Using: ${flight.airline} ${flight.priceText}`);
  console.log(`SearchKey: ${searchKey}, Deeplink: ${flight.deeplink}`);

  // Step 2: Launch browser, capture API calls
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    locale: "en-NG", timezoneId: "Africa/Lagos", userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }
  });
  await context.addInitScript(STEALTH_SCRIPT);
  const page = await context.newPage();

  // Capture wakanow API requests with full details
  page.on("request", async (req) => {
    const url = req.url();
    if (!url.includes("wakanow.com")) return;
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;
    const postData = req.postData();
    console.log(`\n>>> REQ: ${req.method()} ${url}`);
    const headers = req.headers();
    const relevant = Object.fromEntries(
      Object.entries(headers).filter(([k]) => ["content-type", "accept", "cookie", "origin", "referer", "authorization"].includes(k))
    );
    if (Object.keys(relevant).length) console.log(`    Headers: ${JSON.stringify(relevant)}`);
    if (postData) console.log(`    Body: ${postData.slice(0, 3000)}`);
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("wakanow.com")) return;
    const req = res.request();
    const rtype = req.resourceType();
    if (rtype !== "xhr" && rtype !== "fetch") return;
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const data = await res.json();
      console.log(`<<< RES: ${res.status()} ${url.split("?")[0].slice(-80)}`);
      console.log(`    Data: ${JSON.stringify(data).slice(0, 3000)}`);
    } catch {}
  });

  // Load listings
  console.log("\n>>> Loading listings page...");
  await page.goto(flight.deeplink, { waitUntil: "domcontentloaded", timeout: 120_000 });

  // Dismiss cookies
  const cookieBtn = page.locator("text=/yes,?\\s*i\\s*agree/i").first();
  if (await cookieBtn.isVisible({ timeout: 5_000 }).catch(() => false)) await cookieBtn.click();

  await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 120_000 });
  console.log("Flights visible.");

  // Extract Imperva cookies
  const cookies = await context.cookies();
  console.log(`\n>>> Imperva cookies:`);
  for (const c of cookies.filter(c => c.domain.includes("wakanow"))) {
    console.log(`  ${c.name} = ${c.value.slice(0, 60)}... (${c.domain})`);
  }

  // Click Book Now
  console.log("\n>>> Clicking Book Now...");
  await page.locator("div.flight-fare-detail-wrap").first().locator("button.box-button:not(.d-md-none)").first().click();
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
  const bookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
  console.log(`BookingId: ${bookingId}`);

  // Fill form
  console.log("\n>>> Filling form...");
  await page.waitForTimeout(3_000);
  await page.locator("select").first().selectOption({ label: passenger.title });
  await page.locator("[name='booking_lastname']").first().fill(passenger.lastName);
  await page.locator("[name='booking_firstname']").first().fill(passenger.firstName);

  // DOB
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
        if ((cell.textContent ?? "").trim() === "15" && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click(); return;
        }
      }
    });
  }
  await page.waitForTimeout(500);

  await page.locator("#Male0").click().catch(async () => {
    await page.evaluate(() => (document.querySelector("#Male0") as HTMLElement)?.click());
  });
  await page.locator("[name='PhoneNumber']").first().fill(passenger.phone);
  await page.locator("input[type='email']").first().fill(passenger.email);
  await page.waitForTimeout(1_000);

  const cb = page.locator("#acceptTermsAndCondition");
  if (!(await cb.isChecked().catch(() => false))) {
    await cb.click().catch(() => cb.evaluate(el => (el as any).click()));
  }
  await page.waitForTimeout(500);

  // Submit
  console.log("\n>>> Submitting form (Continue)...");
  await page.locator("button:has-text('Continue')").first().click();
  await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 60_000 });
  console.log(`After submit: ${page.url()}`);

  // Addons → Pay Now
  if (page.url().includes("/addons")) {
    console.log("\n>>> Pay Now...");
    await page.waitForTimeout(2_000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2_000);
    await page.locator("text=/pay\\s*now/i").first().click();
  }

  // Payment → Bank Transfer
  await page.waitForTimeout(10_000);
  console.log(`\n>>> Payment page: ${page.url()}`);
  const bankBtn = page.locator("text=/bank.?transfer/i").first();
  if (await bankBtn.count()) {
    await bankBtn.click();
    await page.waitForTimeout(3_000);
  }

  const contBtn = page.locator("text=/continue.*bank.*transfer.*details/i").first();
  if (await contBtn.count()) {
    console.log("\n>>> Continue for bank details...");
    await contBtn.click();
    await page.waitForTimeout(15_000);
  }

  console.log("\n>>> DONE");
  await browser.close();
}

main().catch(console.error);
