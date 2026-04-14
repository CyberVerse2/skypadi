import { env } from "../../config.js";
import type { Passenger } from "../../schemas/flight-booking.js";
import { chromium, type Browser } from "playwright";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NIGERIAN_NAMES = {
  firstNames: {
    male: ["Chukwuemeka", "Oluwaseun", "Adebayo", "Ikechukwu", "Tunde", "Emeka", "Obinna", "Chibueze", "Femi", "Tobi", "Damilola", "Yusuf", "Kelechi", "Chinedu", "Babatunde", "Nnamdi", "Uche", "Segun", "Abubakar", "Adeolu"],
    female: ["Chidinma", "Oluwabunmi", "Adaeze", "Ngozi", "Funke", "Chiamaka", "Blessing", "Amina", "Ifeoma", "Titilayo", "Nneka", "Folake", "Yetunde", "Zainab", "Obiageli", "Bukola", "Halima", "Nkechi", "Aisha", "Ebele"]
  },
  middleNames: {
    male: ["Ifeanyi", "Oluwatobi", "Chukwudi", "Adewale", "Nonso", "Olumide", "Tochukwu", "Ayodeji", "Ugochukwu", "Kayode"],
    female: ["Onyinyechi", "Oluwakemi", "Adaugo", "Omotola", "Uchenna", "Oluwaseyi", "Chisom", "Adetola", "Nkemdilim", "Omolara"]
  },
  lastNames: ["Okonkwo", "Adeyemi", "Okafor", "Ibrahim", "Eze", "Abubakar", "Nwosu", "Balogun", "Obi", "Adekunle", "Uzoma", "Olawale", "Nwachukwu", "Fashola", "Okoro", "Adeleke", "Chukwuma", "Ogundimu", "Usman", "Onyeka"]
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function randomDOB(): string {
  const year = 1975 + Math.floor(Math.random() * 30); // 1975-2004
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function randomPhone(): string {
  const prefixes = ["0803", "0805", "0806", "0807", "0808", "0810", "0811", "0812", "0813", "0814", "0815", "0816", "0817", "0818", "0909", "0908"];
  return pick(prefixes) + String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
}

function randomEmail(firstName: string, lastName: string): string {
  const domains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "mail.com"];
  const sep = pick([".", "_", ""]);
  const num = Math.random() > 0.5 ? String(Math.floor(Math.random() * 99)) : "";
  return `${firstName.toLowerCase()}${sep}${lastName.toLowerCase()}${num}@${pick(domains)}`;
}

/** Generate a random realistic Nigerian passenger for testing */
export function generateTestPassenger(email?: string, gender?: "Male" | "Female"): Passenger {
  const g = gender ?? (Math.random() > 0.5 ? "Male" : "Female");
  const gKey = g.toLowerCase() as "male" | "female";
  const firstName = pick(NIGERIAN_NAMES.firstNames[gKey]);
  const lastName = pick(NIGERIAN_NAMES.lastNames);
  return {
    title: g === "Male" ? pick(["Mr", "Mr", "Mr"]) : pick(["Ms", "Mrs", "Miss"]),
    firstName,
    lastName,
    middleName: pick(NIGERIAN_NAMES.middleNames[gKey]),
    dateOfBirth: randomDOB(),
    nationality: "Nigerian",
    gender: g,
    phone: randomPhone(),
    email: email ?? randomEmail(firstName, lastName)
  };
}

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const p = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      p.refresh = () => {};
      return p;
    }
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = {
    runtime: { connect: () => {}, sendMessage: () => {}, onMessage: { addListener: () => {} } },
    loadTimes: () => ({}), csi: () => ({})
  };
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
  };
`;

export class WakanowApiBookingError extends Error {
  details?: Record<string, unknown>;
  screenshots?: Buffer[];
  constructor(message: string, details?: Record<string, unknown>, screenshots?: Buffer[]) {
    super(message);
    this.name = "WakanowApiBookingError";
    this.details = details;
    this.screenshots = screenshots;
  }
}

export type ApiBookingRequest = {
  searchKey: string;
  flightId: string;
  passenger: Passenger;
  deeplink?: string;
  /** Called when Wakanow asks for email verification code. Return the code string. */
  onVerificationCode?: (email: string) => Promise<string>;
  /** Called to update the user on booking progress */
  onProgress?: (step: string) => Promise<void>;
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

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  const launchOpts: any = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-http2", "--disable-blink-features=AutomationControlled"]
  };
  if (env.PROXY_URL) {
    const url = new URL(env.PROXY_URL);
    launchOpts.proxy = {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: url.username,
      password: url.password
    };
    console.log(`[api-book] Browser: launching with proxy → ${url.hostname}:${url.port}`);
  } else {
    console.log(`[api-book] Browser: launching WITHOUT proxy (PROXY_URL not set)`);
  }
  sharedBrowser = await chromium.launch(launchOpts);
  return sharedBrowser;
}

/**
 * Hybrid booking: browser for navigation + stealth, Angular for API calls.
 * Skips manual form filling by injecting values directly into Angular's reactive forms.
 *
 * Flow: Load listings → Book Now → fill form via JS → Continue (Angular Validate) →
 *       Pay Now → Bank Transfer → Continue (Angular GeneratePNR + MakePayment)
 */
export async function bookFlightApi(request: ApiBookingRequest): Promise<ApiBookingResponse> {
  const { searchKey, passenger, deeplink, onProgress } = request;
  const currency = env.WAKANOW_CURRENCY;
  const notify = (msg: string) => onProgress?.(msg) ?? Promise.resolve();

  console.log(`[api-book] Starting booking...`);
  await notify("✈️ Starting your booking...");

  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-NG,en;q=0.9" },
    geolocation: { latitude: 6.5244, longitude: 3.3792 }, // Lagos
    permissions: ["geolocation"]
  });
  await context.addInitScript(STEALTH_SCRIPT);

  // Set cookies to force Nigerian locale
  await context.addCookies([
    { name: "waaboraliases", value: "en-ng", domain: ".wakanow.com", path: "/" },
    { name: "cultureInfo", value: "en-ng", domain: ".wakanow.com", path: "/" },
    { name: "CountryCode", value: "NG", domain: ".wakanow.com", path: "/" },
    { name: "CurrencyCode", value: "NGN", domain: ".wakanow.com", path: "/" }
  ]);

  let bankTransfers: BankTransferDetails[] = [];
  let totalPrice = 0;
  let airline = "", departure = "", arrival = "", departureTime = "", arrivalTime = "";
  const debugScreenshots: Buffer[] = [];

  try {
    const page = await context.newPage();

    // Intercept API responses for flight info + bank details
    page.on("response", async (res) => {
      const url = res.url();
      if (!url.includes("wakanow.com")) return;
      const req = res.request();
      const rtype = req.resourceType();
      if (rtype !== "xhr" && rtype !== "fetch") return;

      try {
        const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const data = await res.json() as any;

        // Capture flight info from Select
        if (url.includes("/flights/Select/") && data?.FlightSummary) {
          const fc = data.FlightSummary.FlightCombination;
          airline = fc?.Flights?.[0]?.AirlineName ?? "";
          departure = fc?.Flights?.[0]?.DepartureCode ?? "";
          arrival = fc?.Flights?.[0]?.ArrivalCode ?? "";
          departureTime = fc?.Flights?.[0]?.DepartureTime ?? "";
          arrivalTime = fc?.Flights?.[0]?.ArrivalTime ?? "";
          totalPrice = fc?.Price?.Amount ?? 0;
        }

        // Capture bank details from Payment
        const model = data?.PaymentResponseModel;
        if (model) {
          if (model.TotalPrice?.Amount) totalPrice = model.TotalPrice.Amount;
          const parsed = parseBankTransfers(model);
          if (parsed.length > 0) bankTransfers = parsed;
        }

        // Log key API calls
        if (url.includes("/Booking/") || url.includes("/Payment/") || url.includes("/GeneratePNR")) {
          console.log(`[api-book] API: ${req.method()} ${url.split("?")[0].slice(-60)} → ${res.status()}`);
        }
      } catch {}
    });

    // Step 1: Load listings
    const listingsUrl = deeplink ?? `https://www.wakanow.com/en-ng/flights/search?searchKey=${searchKey}`;
    console.log(`[api-book] Loading listings...`);
    await notify("✈️ Loading flight details...");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(listingsUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
        break;
      } catch (e: any) {
        console.log(`[api-book] goto attempt ${attempt}/3 failed: ${e.message.split("\n")[0]}`);
        if (attempt === 3) throw e;
        await page.waitForTimeout(3_000);
      }
    }

    // Dismiss cookie consent — try multiple times, proxy can be slow
    for (let i = 0; i < 3; i++) {
      const cookieBtn = page.locator("text=/yes,?\\s*i\\s*agree/i, button:has-text('I Agree')").first();
      if (await cookieBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await cookieBtn.click();
        await page.waitForTimeout(1_000);
        break;
      }
    }

    // Wait for flights
    try {
      await page.locator("div.flight-fare-detail-wrap").first().waitFor({ state: "visible", timeout: 120_000 });
    } catch {
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "").catch(() => "");
      console.log(`[api-book] Flights didn't load. Page: ${bodyText.slice(0, 200)}`);
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) debugScreenshots.push(shot);
      throw new Error("Flight listings did not load");
    }
    console.log(`[api-book] Flights loaded`);
    await notify("✅ Flight found\n⏳ Selecting your flight...");

    // Step 2: Click Book Now
    const bookBtn = page.locator("div.flight-fare-detail-wrap").first().locator("button.box-button:not(.d-md-none)").first();
    if (await bookBtn.isVisible().catch(() => false)) {
      await bookBtn.click({ timeout: 30_000 });
    } else {
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll("button.box-button")) {
          if ((btn as HTMLElement).offsetParent !== null && btn.textContent?.includes("Book Now")) {
            (btn as HTMLElement).click(); return;
          }
        }
      });
    }

    // Wait for customer-info page
    try {
      await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: 120_000 });
    } catch {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) debugScreenshots.push(shot);
      const modalText = await page.evaluate(() => document.querySelector("[role='dialog']")?.textContent?.slice(0, 200) ?? "").catch(() => "");
      throw new Error(modalText || `Failed to reach customer-info. URL: ${page.url()}`);
    }

    const bookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
    if (!bookingId) throw new Error("Could not extract BookingId");
    console.log(`[api-book] BookingId: ${bookingId}, ${airline} ${departure}→${arrival}`);
    await page.waitForTimeout(3_000);

    // Step 3: Fill form — use fill() for Angular compatibility, with delays between fields
    console.log(`[api-book] Filling form...`);
    await notify("✅ Flight selected\n⏳ Filling in your passenger details...");
    const phoneNum = passenger.phone.startsWith("+") ? passenger.phone.replace(/^\+234/, "0") : passenger.phone;
    const delay = () => page.waitForTimeout(400 + Math.random() * 600);

    await page.locator("select").first().selectOption({ label: passenger.title }).catch(() => {});
    await delay();
    await page.locator("[name='booking_lastname']").first().fill(passenger.lastName);
    await delay();
    await page.locator("[name='booking_firstname']").first().fill(passenger.firstName);
    await delay();
    if (passenger.middleName) {
      await page.locator("[name='booking_middlename']").first().fill(passenger.middleName).catch(() => {});
      await delay();
    }

    // DOB via datepicker
    const [dobYear, dobMonth, dobDay] = passenger.dateOfBirth.split("-");
    const calBtn = page.locator("input[placeholder='yyyy-mm-dd']").first().locator("..").locator("button:has(.fa-calendar), button.btn-outline-dark").first();
    if (await calBtn.count()) {
      await calBtn.click();
    } else {
      await page.locator("input[placeholder='yyyy-mm-dd']").first().click();
    }
    await page.waitForTimeout(1_500);
    const dpSelects = page.locator("ngb-datepicker select");
    if (await dpSelects.count() >= 2) {
      await dpSelects.nth(1).selectOption(dobYear);
      await delay();
      await dpSelects.nth(0).selectOption(String(parseInt(dobMonth)));
      await delay();
      await page.evaluate((day) => {
        for (const cell of document.querySelectorAll("ngb-datepicker div.ngb-dp-day")) {
          if ((cell.textContent ?? "").trim() === day && !cell.classList.contains("ngb-dp-day--outside")) {
            (cell as HTMLElement).click(); return;
          }
        }
      }, String(parseInt(dobDay)));
    }
    await delay();

    // Gender
    const genderId = passenger.gender === "Male" ? "#Male0" : "#Female0";
    await page.locator(genderId).click().catch(() =>
      page.evaluate((id) => (document.querySelector(id) as HTMLElement)?.click(), genderId)
    );
    await delay();

    await page.locator("[name='PhoneNumber']").first().fill(phoneNum);
    await delay();
    await page.locator("input[type='email']").first().fill(passenger.email);
    await delay();

    // Accept terms
    const cb = page.locator("#acceptTermsAndCondition");
    if (!(await cb.isChecked().catch(() => false))) {
      await cb.click().catch(() => cb.evaluate(el => (el as any).click()));
    }
    await delay();

    // Step 4: Click Continue — Angular handles Validate + navigation
    console.log(`[api-book] Submitting form...`);
    await notify("✅ Details filled\n⏳ Submitting to Wakanow... (usually ~15s)");
    await page.locator("button:has-text('Continue'), a:has-text('Continue')").first().click({ timeout: 30_000 });
    await page.waitForTimeout(5_000);

    // Check what happened after Continue click
    if (page.url().includes("/customer-info")) {
      // Screenshot to see what's on screen
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) debugScreenshots.push(shot);

      // Check for any popup/modal (verification code, error, etc.)
      const pageState = await page.evaluate(() => {
        const modal = document.querySelector(".modal, ngb-modal-window, [role='dialog'], .swal2-container");
        const modalText = modal ? (modal as HTMLElement).innerText?.trim().slice(0, 300) : null;
        const bodyText = document.body?.innerText?.slice(0, 500) ?? "";
        const visibleButtons = Array.from(document.querySelectorAll("button, a.btn"))
          .filter(b => (b as HTMLElement).offsetParent !== null)
          .map(b => (b as HTMLElement).innerText?.trim().slice(0, 40))
          .filter(Boolean);
        return { modalText, bodyText: bodyText.slice(0, 200), visibleButtons };
      }).catch(() => ({ modalText: null, bodyText: "", visibleButtons: [] }));

      console.log(`[api-book] Stuck on customer-info. Modal: ${pageState.modalText ?? "none"}`);
      console.log(`[api-book] Buttons: ${JSON.stringify(pageState.visibleButtons)}`);

      // Check if it's a verification code modal
      const isVerification = pageState.modalText && (
        pageState.modalText.toLowerCase().includes("verif") ||
        pageState.modalText.toLowerCase().includes("code") ||
        pageState.modalText.toLowerCase().includes("otp")
      );

      if (isVerification && request.onVerificationCode) {
        console.log(`[api-book] Verification code required`);
        const code = await request.onVerificationCode(passenger.email);
        console.log(`[api-book] Got verification code, entering...`);

        // Type the code into the input field in the modal
        const codeInput = page.locator(".modal input, ngb-modal-window input, [role='dialog'] input").first();
        if (await codeInput.count()) {
          await codeInput.fill(code);
          await page.waitForTimeout(500);
          // Click submit/verify button in modal
          const verifyBtn = page.locator(".modal button:has-text('Verify'), .modal button:has-text('Submit'), .modal button:has-text('Continue'), ngb-modal-window button:has-text('Verify'), ngb-modal-window button:has-text('Submit')").first();
          if (await verifyBtn.count()) {
            await verifyBtn.click();
            await page.waitForTimeout(5_000);
          }
        }
        // Re-click Continue after verification
        if (page.url().includes("/customer-info")) {
          await page.locator("button.box-button:has-text('Continue')").first().click({ timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(5_000);
        }
      } else if (pageState.modalText) {
        // Non-verification popup — try to close and retry
        const closeBtn = page.locator("button:has-text('×'), button.close, button.btn-close").first();
        if (await closeBtn.count()) {
          await closeBtn.click().catch(() => {});
          await page.waitForTimeout(2_000);
          await page.locator("button.box-button:has-text('Continue')").first().click({ timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(5_000);
        }
      }

      // If still on customer-info after handling, fail with details
      if (page.url().includes("/customer-info")) {
        const err: any = new Error(`Booking blocked on customer-info. ${pageState.modalText ?? "No popup detected"}`);
        err.debugScreenshots = debugScreenshots;
        throw err;
      }
    }

    // Wait for navigation to complete
    await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 30_000 })
      .catch(() => {});
    await page.waitForTimeout(2_000);
    console.log(`[api-book] After submit: ${page.url()}`);

    // Step 5: Addons page → Pay Now
    if (page.url().includes("/addons")) {
      await notify("✅ Booking submitted\n⏳ Skipping add-ons...");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);
      await page.locator("text=/pay\\s*now/i").first().click({ timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(5_000);
    }

    // Step 6: Payment page → Bank Transfer → Continue
    console.log(`[api-book] Payment page: ${page.url()}`);
    await notify("✅ Almost there\n⏳ Getting payment details...");
    await page.waitForTimeout(5_000); // Wait for payment options to load

    // Click Bank Transfer
    const bankBtn = page.locator("text=/bank.?transfer/i").first();
    if (await bankBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await bankBtn.click();
      await page.waitForTimeout(2_000);
    }

    // Click Continue to see bank details — triggers GeneratePNR + MakePayment
    const continueBtn = page.locator("text=/continue.*bank/i, text=/continue.*transfer/i, button:has-text('Continue')").last();
    if (await continueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      console.log(`[api-book] Clicking Continue for bank details...`);
      await continueBtn.click();
      await page.waitForTimeout(15_000);
    }

    console.log(`[api-book] Booking complete! ID: ${bookingId}, ${bankTransfers.length} bank(s), ₦${totalPrice.toLocaleString()}`);
    await notify("✅ Booking complete!");

    await page.close();

    const paymentUrl = `https://www.wakanow.com/en-ng/booking/${bookingId}/payment?products=Flight&reqKey=${searchKey}`;

    return {
      provider: "wakanow",
      bookedAt: new Date().toISOString(),
      bookingId,
      status: "pending_payment",
      paymentUrl,
      bankTransfers: bankTransfers.length > 0 ? bankTransfers : undefined,
      flightSummary: { airline, departure, arrival, departureTime, arrivalTime, price: totalPrice, currency }
    };
  } catch (e: any) {
    console.log(`[api-book] Failed: ${e.message}`);
    throw new WakanowApiBookingError(`Booking failed: ${e.message}`, undefined, (e as any).debugScreenshots ?? debugScreenshots);
  } finally {
    await context.close();
  }
}

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
