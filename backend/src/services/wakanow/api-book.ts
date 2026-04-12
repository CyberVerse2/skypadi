import { env } from "../../config.js";
import type { Passenger } from "../../schemas/flight-booking.js";
import { chromium, type Browser, type BrowserContext } from "playwright";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class WakanowApiBookingError extends Error {
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WakanowApiBookingError";
    this.details = details;
  }
}

export type ApiBookingRequest = {
  searchKey: string;
  flightId: string;
  passenger: Passenger;
  deeplink?: string;
};

export type BankTransferDetails = {
  bank: string;
  accountNumber: string;
  beneficiary: string;
  expiresIn: string;
  note: string;
};

export type ApiBookingResponse = {
  provider: "wakanow";
  bookedAt: string;
  bookingId: string;
  status: "pending_payment";
  paymentUrl: string;
  bankTransfers?: BankTransferDetails[];
  flightSummary: {
    airline: string;
    departure: string;
    arrival: string;
    departureTime: string;
    arrivalTime: string;
    price: number;
    currency: string;
  };
};

export async function bookFlightApi(request: ApiBookingRequest): Promise<ApiBookingResponse> {
  const { searchKey, flightId, passenger, deeplink } = request;
  const currency = env.WAKANOW_CURRENCY;

  // Full browser flow — navigates through the Angular app like a real user
  // (listings → Book Now → customer-info → fill form → Continue → addons → Pay Now → payment → Bank Transfer → Continue)
  // No API Select — the browser's "Book Now" click handles selection internally
  console.log(`[api-book] Starting full browser booking flow for flight ${flightId}...`);
  let bankTransfers: BankTransferDetails[] = [];
  let totalPrice = 0;
  let bookingId = "";

  try {
    const result = await finalizeBookingViaBrowser(searchKey, passenger, deeplink);
    bankTransfers = result.bankTransfers;
    if (result.totalPrice) totalPrice = result.totalPrice;
    bookingId = result.bookingId ?? "";
    console.log(`[api-book] Browser flow complete. BookingId: ${bookingId}, ${bankTransfers.length} bank account(s), ₦${totalPrice.toLocaleString()}`);
  } catch (e: any) {
    console.log(`[api-book] Browser flow failed: ${e.message}`);
    console.log(`[api-book] Stack: ${e.stack}`);
    throw new WakanowApiBookingError(`Booking failed: ${e.message}`);
  }

  if (!bookingId) {
    throw new WakanowApiBookingError("Could not get BookingId from browser flow.");
  }

  const paymentUrl = `https://www.wakanow.com/en-ng/booking/${bookingId}/payment?products=Flight&reqKey=${searchKey}`;

  return {
    provider: "wakanow",
    bookedAt: new Date().toISOString(),
    bookingId,
    status: "pending_payment",
    paymentUrl,
    bankTransfers: bankTransfers.length > 0 ? bankTransfers : undefined,
    flightSummary: {
      airline: "",
      departure: "",
      arrival: "",
      departureTime: "",
      arrivalTime: "",
      price: totalPrice,
      currency
    }
  };
}

/** Parse bank transfer details from Wakanow PaymentResponseModel */
function parseBankTransfers(paymentModel: any): BankTransferDetails[] {
  const transfers: BankTransferDetails[] = [];
  const bankOption = paymentModel?.PaymentOptions?.find(
    (o: any) => o.Name?.toLowerCase().includes("bank")
  );
  if (!bankOption?.PaymentMethods?.[0]) return transfers;

  const desc = bankOption.PaymentMethods[0].PaymentDescription ?? "";
  const bankBlocks = desc.split(/<!--#rowstart#-->/i).filter((b: string) => b.includes("Account Number"));
  for (const block of bankBlocks) {
    const bankMatch = block.match(/<p[^>]*class="font-weight-medium[^"]*"[^>]*>([^<]+)<\/p>/i);
    const acctMatch = block.match(/Account Number<\/p>\s*<p[^>]*>(\d+)<\/p>/i);
    const beneficiaryMatch = block.match(/Beneficiary<\/p>\s*<p[^>]*>([^<]+)<\/p>/i);
    if (acctMatch) {
      transfers.push({
        bank: bankMatch?.[1]?.trim() ?? "Unknown Bank",
        accountNumber: acctMatch[1],
        beneficiary: beneficiaryMatch?.[1]?.trim() ?? "Wakanow.com Collections",
        expiresIn: "9 hours",
        note: "Account details are unique to this transaction. Do not use for other transactions."
      });
    }
  }
  // Fallback: single bank parse
  if (transfers.length === 0) {
    const acctMatch = desc.match(/Account Number<\/p>\s*<p[^>]*>(\d+)<\/p>/i);
    if (acctMatch) {
      const bankMatch = desc.match(/<p[^>]*>([^<]*Bank[^<]*)<\/p>/i);
      transfers.push({
        bank: bankMatch?.[1]?.trim() ?? "Wema Bank",
        accountNumber: acctMatch[1],
        beneficiary: "Wakanow.com Collections",
        expiresIn: "9 hours",
        note: "Account details are unique to this transaction. Do not use for other transactions."
      });
    }
  }
  return transfers;
}

// Keep a shared browser instance to avoid cold-start overhead on each booking
let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  const launchOpts: any = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-http2", "--disable-blink-features=AutomationControlled"]
  };
  // Proxy disabled for now
  // if (env.PROXY_URL) {
  //   const url = new URL(env.PROXY_URL);
  //   launchOpts.proxy = {
  //     server: `${url.protocol}//${url.hostname}:${url.port}`,
  //     username: url.username,
  //     password: url.password
  //   };
  // }
  sharedBrowser = await chromium.launch(launchOpts);
  return sharedBrowser;
}

/**
 * Full browser navigation flow: search results → Book Now → fill form → submit →
 * addons → Pay Now → payment → Bank Transfer → Continue To See Bank Transfer Details.
 *
 * This mirrors exactly what a real user does. The Angular app handles all API calls
 * (Select, Validate, Confirm, GeneratePNR, MakePayment) internally, which avoids
 * the Imperva bot-protection 500 errors that happen with cross-origin fetch.
 */
async function finalizeBookingViaBrowser(
  searchKey: string,
  passenger: Passenger,
  deeplink?: string
): Promise<{ bankTransfers: BankTransferDetails[]; totalPrice?: number; bookingId?: string }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: USER_AGENT
  });

  let bankTransfers: BankTransferDetails[] = [];
  let totalPrice: number | undefined;
  let browserBookingId: string | undefined;

  try {
    const page = await context.newPage();

    // Intercept API responses to capture bank details and price
    page.on("response", async (res) => {
      const url = res.url();
      if (!url.includes("wakanow.com") || /\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(url)) return;
      if (/google|facebook|analytics|gtm|freshchat|clarity|optimonk/i.test(url)) return;
      const req = res.request();
      const rtype = req.resourceType();
      if (rtype !== "xhr" && rtype !== "fetch") return;
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;

      try {
        const data = await res.json() as any;
        // Capture from Payment/Get or MakePayment
        const model = data?.PaymentResponseModel;
        if (model) {
          if (model.TotalPrice?.Amount) totalPrice = model.TotalPrice.Amount;
          const parsed = parseBankTransfers(model);
          if (parsed.length > 0) bankTransfers = parsed;
        }
        // Log key API calls for debugging
        if (url.includes("/Booking/") || url.includes("/Payment/") || url.includes("/GeneratePNR")) {
          console.log(`[api-book] Browser API: ${req.method()} ${url.split("?")[0].slice(-60)} → ${res.status()}`);
        }
      } catch { /* ignore unreadable responses */ }
    });

    // Step 1: Navigate to flight listings (the deeplink from search)
    const listingsUrl = deeplink ?? `https://www.wakanow.com/en-ng/flights/search?searchKey=${searchKey}`;
    console.log(`[api-book] Browser: loading listings → ${listingsUrl.slice(0, 100)}...`);
    await page.goto(listingsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    console.log(`[api-book] Browser: page loaded, URL: ${page.url()}`);
    const pageTitle = await page.title().catch(() => "");
    console.log(`[api-book] Browser: page title: "${pageTitle}"`);
    try {
      await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 60_000 });
    } catch {
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "").catch(() => "");
      console.log(`[api-book] Browser: page text: ${bodyText}`);
      throw new Error("Flight listings did not load. Page may be blocked or showing captcha.");
    }
    await page.waitForTimeout(3_000);

    // Step 2: Click "Book Now" on the first flight
    console.log(`[api-book] Browser: clicking Book Now...`);
    await page.locator("div.flight-fare-detail-wrap").first().locator("text=Book Now").first().click({ timeout: 5_000 });

    // Step 3: Wait for customer-info page
    console.log(`[api-book] Browser: waiting for customer-info page...`);
    try {
      await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 60_000 });
    } catch {
      console.log(`[api-book] Browser: customer-info page not reached. Current URL: ${page.url()}`);
      throw new Error(`Failed to reach customer-info page. URL: ${page.url()}`);
    }
    await page.waitForTimeout(5_000);
    // Capture the BookingId from the browser URL
    browserBookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
    console.log(`[api-book] Browser: BookingId from URL: ${browserBookingId}`);

    // Step 4: Fill passenger form
    console.log(`[api-book] Browser: filling passenger form...`);
    // Title
    await page.locator("select").first().selectOption({ label: passenger.title }).catch(() => {});
    await page.waitForTimeout(300);
    // Names
    await page.locator("[name='booking_lastname']").first().fill(passenger.lastName).catch(() => {});
    await page.locator("[name='booking_firstname']").first().fill(passenger.firstName).catch(() => {});
    await page.locator("[name='booking_middlename']").first().fill(passenger.middleName ?? "").catch(() => {});

    // Date of birth — open datepicker, select year then month, then click day
    const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();
    const [dobYear, dobMonth, dobDay] = passenger.dateOfBirth.split("-");

    // Click the calendar button next to the DOB input to open datepicker
    const dobContainer = page.locator("input[placeholder='yyyy-mm-dd']").first().locator("..");
    const calButton = dobContainer.locator("button:has(.fa-calendar), button.btn-outline-dark").first();
    if (await calButton.count()) {
      await calButton.click({ timeout: 3_000 });
      console.log(`[api-book] Browser: clicked calendar button`);
    } else {
      await dobInput.click({ timeout: 3_000 }).catch(() => {});
      console.log(`[api-book] Browser: clicked DOB input directly`);
    }
    await page.waitForTimeout(1_500);

    // The datepicker has 2 selects: month (index 0), year (index 1)
    const dpSelects = page.locator("ngb-datepicker select");

    async function fillDatepicker() {
      const count = await dpSelects.count();
      if (count < 2) return false;
      console.log(`[api-book] Browser: setting DOB: year=${dobYear} month=${dobMonth} day=${dobDay}`);
      await dpSelects.nth(1).selectOption(dobYear);
      await page.waitForTimeout(500);
      await dpSelects.nth(0).selectOption(String(parseInt(dobMonth)));
      await page.waitForTimeout(500);
      const dayStr = String(parseInt(dobDay));
      await page.evaluate((day) => {
        const cells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
        for (const cell of cells) {
          if ((cell.textContent ?? "").trim() === day && !cell.classList.contains("ngb-dp-day--outside")) {
            (cell as HTMLElement).click(); return;
          }
        }
      }, dayStr);
      await page.waitForTimeout(500);
      return true;
    }

    if (!(await fillDatepicker())) {
      console.log(`[api-book] Browser: datepicker not open, retrying...`);
      await dobInput.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      await fillDatepicker();
    }

    const dobValue = await dobInput.inputValue().catch(() => "");
    console.log(`[api-book] Browser: DOB field value: "${dobValue}"`);

    // Nationality — pre-filled as ng-select with "Nigeria", no action needed for domestic flights
    // Just verify it's set
    const natSet = await page.evaluate(() => {
      const ngSelect = document.querySelector("ng-select[formcontrolname='CountryCode']");
      return ngSelect?.classList.contains("ng-valid") ?? false;
    });
    console.log(`[api-book] Browser: nationality valid: ${natSet}`);

    // Gender
    const genderId = passenger.gender === "Male" ? "#Male0" : "#Female0";
    await page.locator(genderId).click({ timeout: 3_000 }).catch(async () => {
      await page.evaluate((id) => (document.querySelector(id) as HTMLElement)?.click(), genderId);
    });
    console.log(`[api-book] Browser: clicked gender ${passenger.gender}`);

    // Phone & Email
    const phoneNum = passenger.phone.startsWith("+") ? passenger.phone.replace(/^\+234/, "0") : passenger.phone;
    await page.locator("[name='PhoneNumber']").first().fill(phoneNum).catch(() => {});
    await page.locator("input[type='email']").first().fill(passenger.email).catch(() => {});
    await page.waitForTimeout(1_000);

    // Debug: check for validation errors before submitting
    const validationErrors = await page.evaluate(() => {
      const errors = document.querySelectorAll(".invalid-feedback:not(:empty), .text-danger:not(:empty), .error-msg:not(:empty), .ng-invalid.ng-touched");
      return Array.from(errors).map(e => (e as HTMLElement).textContent?.trim()).filter(Boolean).slice(0, 5);
    });
    if (validationErrors.length > 0) {
      console.log(`[api-book] Browser: validation errors: ${JSON.stringify(validationErrors)}`);
    }

    // Debug: verify key fields are filled
    const formState = await page.evaluate(() => {
      const lastName = (document.querySelector("[name='booking_lastname']") as HTMLInputElement)?.value ?? "";
      const firstName = (document.querySelector("[name='booking_firstname']") as HTMLInputElement)?.value ?? "";
      const dob = (document.querySelector("input[placeholder='yyyy-mm-dd']") as HTMLInputElement)?.value ?? "";
      const phone = (document.querySelector("[name='PhoneNumber']") as HTMLInputElement)?.value ?? "";
      const email = (document.querySelector("input[type='email']") as HTMLInputElement)?.value ?? "";
      const checkbox = (document.getElementById("acceptTermsAndCondition") as HTMLInputElement)?.checked ?? false;
      return { lastName, firstName, dob, phone, email, checkbox };
    });
    console.log(`[api-book] Browser: form state: ${JSON.stringify(formState)}`);

    // Step 5: Accept terms & click Continue
    console.log(`[api-book] Browser: submitting form...`);
    const cb = page.locator("#acceptTermsAndCondition");
    if (!(await cb.isChecked().catch(() => false))) {
      await cb.click({ timeout: 2_000 }).catch(() => cb.evaluate(el => (el as any).click())).catch(() => {});
    }
    await page.waitForTimeout(500);
    await page.locator("button:has-text('Continue'), a:has-text('Continue')").first().click({ timeout: 5_000 });

    // Step 6: Handle any popups/modals and wait for navigation
    console.log(`[api-book] Browser: waiting for page change...`);
    await page.waitForTimeout(3_000);

    // Take debug screenshot if still on customer-info
    if (page.url().includes("/customer-info")) {
      await page.screenshot({ path: "/tmp/skypadi-debug-after-continue.png", fullPage: true }).catch(() => {});
      console.log(`[api-book] Browser: debug screenshot → /tmp/skypadi-debug-after-continue.png`);

      // Try to find and dismiss any popup/modal/overlay
      const popupBtns = await page.evaluate(() => {
        const btns = document.querySelectorAll("button, a.btn");
        return Array.from(btns)
          .filter(b => {
            const style = window.getComputedStyle(b);
            return style.display !== "none" && style.visibility !== "hidden";
          })
          .map(b => ({ text: (b as HTMLElement).innerText?.trim().slice(0, 50), class: b.className.slice(0, 60) }));
      });
      console.log(`[api-book] Browser: visible buttons: ${JSON.stringify(popupBtns)}`);

      // Close any verification code popup or info modal
      const closeBtn = page.locator("button.float-end:has-text('×'), button:has-text('×')").first();
      if (await closeBtn.count()) {
        console.log(`[api-book] Browser: closing popup via × button...`);
        await closeBtn.click({ timeout: 3_000 }).catch(() => {});
        await page.waitForTimeout(2_000);
        // After closing popup, re-click Continue to submit the form
        console.log(`[api-book] Browser: re-submitting after popup dismiss...`);
        await page.locator("button.box-button:has-text('Continue')").first().click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(3_000);
      }

      // Click "Continue" on any remaining modal
      for (const selector of [
        ".modal-content button:has-text('Continue')",
        ".modal button:has-text('Continue')",
        ".swal2-confirm",
        "ngb-modal-window button:has-text('Continue')",
        "button.btn-primary:has-text('Continue')"
      ]) {
        const btn = page.locator(selector).first();
        if (await btn.count()) {
          console.log(`[api-book] Browser: clicking popup button: ${selector}`);
          await btn.click({ timeout: 3_000 }).catch(() => {});
          await page.waitForTimeout(3_000);
          break;
        }
      }

      // If still on customer-info, the main Continue might not have submitted — re-click it
      if (page.url().includes("/customer-info")) {
        console.log(`[api-book] Browser: re-clicking Continue...`);
        await page.locator("button.box-button:has-text('Continue')").first().click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(3_000);
      }
    }

    // Wait for URL to change away from customer-info
    await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 20_000 })
      .catch(() => console.log(`[api-book] Browser: still on customer-info after 20s`));
    await page.waitForTimeout(3_000);
    console.log(`[api-book] Browser: URL after submit: ${page.url()}`);

    // Step 7: Click "Pay Now" on addons page
    if (page.url().includes("/addons")) {
      console.log(`[api-book] Browser: clicking Pay Now...`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2_000);
      await page.locator("text=/pay\\s*now/i").first().click({ timeout: 5_000 });
    }

    // Step 8: Wait for payment page
    console.log(`[api-book] Browser: waiting for payment page...`);
    await page.waitForTimeout(10_000);
    console.log(`[api-book] Browser: URL at payment: ${page.url()}`);

    // Step 9: Click "Bank Transfer" option
    console.log(`[api-book] Browser: clicking Bank Transfer...`);
    const bankBtn = page.locator("text=/bank.?transfer/i").first();
    if (await bankBtn.count()) {
      await bankBtn.click({ timeout: 5_000 });
      await page.waitForTimeout(3_000);
      console.log(`[api-book] Browser: clicked Bank Transfer`);
    }

    // Step 10: Click "Continue To See Bank Transfer Details" — triggers GeneratePNR + MakePayment
    console.log(`[api-book] Browser: clicking Continue to see bank details...`);
    const continueBtn = page.locator("text=/continue.*bank.*transfer.*details/i").first();
    if (await continueBtn.count()) {
      await continueBtn.click({ timeout: 5_000 });
      console.log(`[api-book] Browser: clicked Continue — waiting for PNR + payment...`);
      await page.waitForTimeout(12_000);

      // If bank details weren't captured via API intercept, parse from page text
      if (bankTransfers.length === 0) {
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
        console.log(`[api-book] Browser: parsing bank details from page text...`);
        // Try to extract bank details from visible page text
        const gtbMatch = pageText.match(/GTBank[^\n]*\n.*?(\d{10})/s);
        const wemaMatch = pageText.match(/Wema\s*Bank[^\n]*\n.*?(\d{10})/s);
        if (gtbMatch) bankTransfers.push({ bank: "GTBank", accountNumber: gtbMatch[1], beneficiary: "Wakanow.com Collections", expiresIn: "9 hours", note: "Account details are unique to this transaction." });
        if (wemaMatch) bankTransfers.push({ bank: "Wema Bank", accountNumber: wemaMatch[1], beneficiary: "Wakanow.com Collections", expiresIn: "9 hours", note: "Account details are unique to this transaction." });
      }
    } else {
      console.log(`[api-book] Browser: Continue button not found`);
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
      console.log(`[api-book] Browser: page text (300): ${pageText.slice(0, 300)}`);
    }

    await page.close();
  } finally {
    await context.close();
  }

  return { bankTransfers, totalPrice, bookingId: browserBookingId };
}

