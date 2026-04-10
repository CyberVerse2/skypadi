import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "../../config.js";
import type {
  FlightBookingRequest,
  FlightBookingResponse,
  Passenger
} from "../../schemas/flight-booking.js";

type TraceEvent = {
  timestamp: string;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

type BookingRuntimeOptions = {
  onTrace?: (event: TraceEvent) => void;
};

type Tracer = (step: string, message: string, data?: Record<string, unknown>) => void;

const SETTLE_MS = 1_000;

export class WakanowBookingError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WakanowBookingError";
    this.details = details;
  }
}

export async function bookWakanowFlight(
  request: FlightBookingRequest,
  options: BookingRuntimeOptions = {}
): Promise<FlightBookingResponse> {
  const trace = createTracer(options);
  const headless = request.headless ?? env.WAKANOW_HEADLESS;
  const timeoutMs = request.timeoutMs ?? env.WAKANOW_TIMEOUT_MS;

  trace("browser.launch", "Launching Chromium", { headless });
  const browser = await chromium.launch({
    headless,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    locale: env.WAKANOW_LOCALE,
    timezoneId: env.WAKANOW_TIMEZONE,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    return await runBookingFlow(page, request, timeoutMs, trace);
  } finally {
    trace("browser.close", "Closing browser resources");
    await safeClose(page, context, browser);
  }
}

async function runBookingFlow(
  page: Page,
  request: FlightBookingRequest,
  timeoutMs: number,
  trace: Tracer
): Promise<FlightBookingResponse> {
  // Step 1: Validate deeplink and navigate to results page
  const allowedHost = "www.wakanow.com";
  const deeplinkUrl = new URL(request.deeplink);
  if (deeplinkUrl.host !== allowedHost || !deeplinkUrl.pathname.startsWith("/flight/listings/")) {
    throw new Error(`Invalid deeplink: must be a Wakanow flight listings URL (got ${deeplinkUrl.host}${deeplinkUrl.pathname})`);
  }

  trace("results.goto", "Opening flight results page", { url: request.deeplink });
  await page.goto(request.deeplink, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });

  // Wait for flight cards to load
  await page
    .locator("div.flight-fare-detail-wrap")
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForTimeout(3_000);
  trace("results.loaded", "Flight results loaded", { url: page.url() });

  // Step 2: Click "Book Now" on the target flight
  await selectAndBookFlight(page, request.flightIndex, trace);

  // Step 3: Wait for booking form
  await page.waitForURL(/\/booking\/.*\/customer-info/i, { timeout: timeoutMs });
  await page.waitForTimeout(3_000);
  trace("booking.loaded", "Booking form loaded", { url: page.url() });

  // Step 4: Fill passenger form
  const passenger = request.passengers[0];
  await fillPassengerForm(page, passenger, trace);

  // Step 5: Accept terms and click Continue
  await acceptAndContinue(page, trace);

  // Step 6: Wait for next page and capture result
  await page.waitForTimeout(8_000);
  const currentUrl = page.url();
  const bodyText = collapseWhitespace(
    await page.locator("body").innerText().catch(() => "")
  );

  const currentStep = detectStep(currentUrl, bodyText);
  trace("booking.result", "Booking step completed", { currentStep, currentUrl });

  return {
    provider: "wakanow",
    bookedAt: new Date().toISOString(),
    request,
    currentStep,
    currentUrl,
    pageContent: bodyText.slice(0, 2000)
  };
}

async function selectAndBookFlight(page: Page, flightIndex: number, trace: Tracer) {
  const cards = page.locator("div.flight-fare-detail-wrap");
  const count = await cards.count();

  if (flightIndex >= count) {
    throw new WakanowBookingError("Flight index out of range.", {
      flightIndex,
      availableCards: count
    });
  }

  const card = cards.nth(flightIndex);
  const bookBtn = card.locator("text=Book Now").first();

  if (!(await bookBtn.count())) {
    throw new WakanowBookingError("No Book Now button found on the selected flight card.", {
      flightIndex
    });
  }

  trace("booking.click", "Clicking Book Now", { flightIndex });
  await bookBtn.click({ timeout: 5_000 });
}

async function fillPassengerForm(page: Page, passenger: Passenger, trace: Tracer) {
  trace("form.fill", "Filling passenger details", {
    name: `${passenger.firstName} ${passenger.lastName}`
  });

  // Title (select dropdown)
  const titleSelect = page.locator("select").first();
  await titleSelect.selectOption({ label: passenger.title }).catch(() =>
    titleSelect.selectOption(passenger.title).catch(() => undefined)
  );
  await page.waitForTimeout(300);

  // Last Name
  await page.locator("[name='booking_lastname']").first().fill(passenger.lastName);

  // First Name
  await page.locator("[name='booking_firstname']").first().fill(passenger.firstName);

  // Middle Name
  if (passenger.middleName) {
    await page.locator("[name='booking_middlename']").first().fill(passenger.middleName);
  }

  // Date of Birth — readonly ngb-datepicker input, must click to open picker
  await fillDobDatepicker(page, passenger.dateOfBirth, trace);

  // Nationality — typeahead input, find by label text
  await fillNationality(page, passenger.nationality, trace);

  // Gender (radio button)
  const genderRadio = page.locator(
    passenger.gender === "Male" ? "#Male0" : "#Female0"
  );
  await genderRadio.click({ timeout: 2_000 }).catch(() =>
    page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.click();
    }, passenger.gender === "Male" ? "Male0" : "Female0")
  );
  await page.waitForTimeout(300);

  // Phone
  await page.locator("[name='PhoneNumber']").first().fill(passenger.phone);
  await page.waitForTimeout(300);

  // Email
  await page.locator("input[type='email']").first().fill(passenger.email);
  await page.waitForTimeout(300);

  // Debug: log form field states
  const fieldStates = await page.evaluate(() => {
    const fields = [
      "booking_lastname", "booking_firstname", "booking_middlename", "PhoneNumber"
    ];
    const states: Record<string, string> = {};
    for (const name of fields) {
      const el = document.querySelector<HTMLInputElement>(`[name='${name}']`);
      if (el) states[name] = `value="${el.value}" class="${el.className}"`;
    }
    const email = document.querySelector<HTMLInputElement>("input[type='email']");
    if (email) states["email"] = `value="${email.value}" class="${email.className}"`;
    const dob = document.querySelector<HTMLInputElement>("input[placeholder='yyyy-mm-dd']");
    if (dob) states["dob"] = `value="${dob.value}" class="${dob.className}"`;
    return states;
  });
  trace("form.debug", "Field states after filling", fieldStates);

  await page.waitForTimeout(SETTLE_MS);
  trace("form.filled", "Passenger form completed");
}

async function fillDobDatepicker(page: Page, dob: string, trace: Tracer) {
  const date = new Date(`${dob}T12:00:00`);
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + 1; // 1-based
  const targetDay = date.getDate();

  trace("form.dob", "Opening DOB datepicker", { dob });

  // Click the DOB input to open the datepicker
  const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();
  await dobInput.click({ timeout: 3_000 });
  await page.waitForTimeout(500);

  // The DOB datepicker has month and year SELECT dropdowns inside ngb-datepicker
  const datepicker = page.locator("ngb-datepicker:visible").first();
  const dpVisible = await datepicker.waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (!dpVisible) {
    // Try clicking via evaluate
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("input[placeholder='yyyy-mm-dd']");
      input?.click();
      input?.focus();
    });
    await page.waitForTimeout(500);
  }

  trace("form.dob", "Datepicker opened, setting year and month", { targetYear, targetMonth });

  // Use page.evaluate to inspect what selects are available and set them
  const selectInfo = await page.evaluate(() => {
    const selects = document.querySelectorAll<HTMLSelectElement>("ngb-datepicker select");
    const info: Array<{ index: number; name: string; options: string[]; value: string }> = [];
    selects.forEach((sel, i) => {
      info.push({
        index: i,
        name: sel.getAttribute("aria-label") ?? sel.title ?? sel.name ?? `select-${i}`,
        options: Array.from(sel.options).map(o => `${o.value}:${o.text}`),
        value: sel.value
      });
    });
    return info;
  });
  trace("form.dob", "Datepicker selects", { selectInfo });

  // Set year first (year select is typically the one with numeric year values)
  // Then set month
  await page.evaluate(({ yr, mo }) => {
    const selects = document.querySelectorAll<HTMLSelectElement>("ngb-datepicker select");
    for (const sel of selects) {
      const label = sel.getAttribute("aria-label") ?? "";
      // Find year select
      if (/year/i.test(label)) {
        sel.value = String(yr);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Find month select
      if (/month/i.test(label)) {
        sel.value = String(mo);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, { yr: targetYear, mo: targetMonth });
  await page.waitForTimeout(500);

  // Fallback: try by index if aria-label approach didn't work
  // ngb-datepicker typically has month select first (index 0), year select second (index 1)
  await page.evaluate(({ yr, mo }) => {
    const selects = document.querySelectorAll<HTMLSelectElement>("ngb-datepicker select");
    if (selects.length >= 2) {
      // Check if values are already correct
      const monthSel = selects[0];
      const yearSel = selects[1];
      if (yearSel.value !== String(yr)) {
        yearSel.value = String(yr);
        yearSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (monthSel.value !== String(mo)) {
        monthSel.value = String(mo);
        monthSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, { yr: targetYear, mo: targetMonth });
  await page.waitForTimeout(500);

  // Click the target day cell
  const ariaLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  trace("form.dob", "Clicking day cell", { ariaLabel });

  // Try aria-label first
  let dayClicked = false;
  const dayCell = datepicker.locator(`div.ngb-dp-day[aria-label="${ariaLabel}"]`).first();
  if (await dayCell.count()) {
    await dayCell.click({ timeout: 2_000 });
    dayClicked = true;
  }

  if (!dayClicked) {
    // Fallback: find by day number text
    await page.evaluate((day) => {
      const dayCells = document.querySelectorAll("ngb-datepicker div.ngb-dp-day");
      for (const cell of dayCells) {
        const text = (cell.textContent ?? "").trim();
        if (text === String(day) && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click();
          return;
        }
      }
    }, targetDay);
  }

  await page.waitForTimeout(500);
  trace("form.dob", "DOB date selected", { dob });
}

async function fillNationality(page: Page, nationality: string, trace: Tracer) {
  trace("form.nationality", "Filling nationality", { nationality });

  // Type into the nationality input — find it by nearby label
  const typed = await page.evaluate((nat) => {
    // Look for input near a "Nationality" label
    const labels = document.querySelectorAll("label, span");
    for (const label of labels) {
      if (/nationality/i.test(label.textContent ?? "")) {
        const container = label.closest(".form-group, .col, div");
        const input = container?.querySelector<HTMLInputElement>("input");
        if (input) {
          input.focus();
          input.value = nat;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
    }
    // Fallback: look for input with formcontrolname containing "nationality"
    const natInput = document.querySelector<HTMLInputElement>(
      "input[formcontrolname*='ationality'], input[formcontrolname*='nationality']"
    );
    if (natInput) {
      natInput.focus();
      natInput.value = nat;
      natInput.dispatchEvent(new Event("input", { bubbles: true }));
      natInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, nationality);

  if (!typed) {
    trace("form.nationality", "Could not find nationality input by label, trying typeahead");
  }

  await page.waitForTimeout(800);

  // If a suggestion dropdown appeared, click the matching option
  const suggestion = page
    .locator("[role='listbox']:visible, .dropdown-menu:visible, .typeahead-container:visible, ngb-typeahead-window:visible")
    .locator(`text=/${nationality}/i`)
    .first();
  if (await suggestion.count()) {
    await suggestion.click({ timeout: 2_000 }).catch(() => undefined);
    trace("form.nationality", "Selected nationality from dropdown");
  }
  await page.waitForTimeout(300);
}

async function acceptAndContinue(page: Page, trace: Tracer) {
  // Check the terms checkbox
  const checkbox = page.locator("#acceptTermsAndCondition");
  const checked = await checkbox.isChecked().catch(() => false);
  if (!checked) {
    await checkbox.click({ timeout: 2_000 }).catch(() =>
      checkbox.evaluate((el) => (el as HTMLInputElement).click()).catch(() => undefined)
    );
  }
  await page.waitForTimeout(500);

  // Click Continue
  const continueBtn = page.locator("button:has-text('Continue'), a:has-text('Continue')").first();
  if (!(await continueBtn.count())) {
    throw new WakanowBookingError("Unable to find Continue button on booking form.");
  }

  trace("form.submit", "Clicking Continue");
  await continueBtn.click({ timeout: 5_000 });
}

function detectStep(url: string, bodyText: string): string {
  if (/customer-info/i.test(url)) return "customer-info";
  if (/trip-custom|addons/i.test(url)) return "trip-customization";
  if (/payment/i.test(url)) return "payment";
  if (/confirm/i.test(url)) return "confirmation";
  if (/error|fail/i.test(bodyText.slice(0, 500))) return "error";
  return "unknown";
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function createTracer(options: BookingRuntimeOptions): Tracer {
  return (step, message, data) => {
    options.onTrace?.({
      timestamp: new Date().toISOString(),
      step,
      message,
      data
    });
  };
}

async function safeClose(page: Page, context: BrowserContext, browser: Browser) {
  await page.close().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
