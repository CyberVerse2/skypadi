import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { env } from "../../config.js";
import type {
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSearchResult
} from "../../schemas/flight-search.js";

type SearchTraceEvent = {
  timestamp: string;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

type SearchRuntimeOptions = {
  onTrace?: (event: SearchTraceEvent) => void;
};

type SearchTracer = (step: string, message: string, data?: Record<string, unknown>) => void;
type LocationField = "departure" | "destination";
type DateField = "departure" | "return";

const LOCATION_ALIASES: Record<string, string> = {
  LOS: "Lagos",
  ABV: "Abuja",
  PHC: "Port Harcourt",
  DXB: "Dubai",
  DOH: "Doha",
  LHR: "London",
  JNB: "Johannesburg"
};

const QUICK_WAIT_MS = 250;
const PICKER_SETTLE_MS = 900;
const SUGGESTION_POLL_MS = 250;
const SUGGESTION_TIMEOUT_MS = 5_000;
const DATE_PICKER_TIMEOUT_MS = 3_000;

export class WakanowSearchError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WakanowSearchError";
    this.details = details;
  }
}

export async function searchWakanowFlights(
  request: FlightSearchRequest,
  options: SearchRuntimeOptions = {}
): Promise<FlightSearchResponse> {
  const trace = createTracer(options);
  const headless = request.headless ?? env.WAKANOW_HEADLESS;
  const timeoutMs = request.timeoutMs ?? env.WAKANOW_TIMEOUT_MS;

  trace("browser.launch", "Launching Chromium", { headless });
  const browser = await chromium.launch({
    headless,
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"]
  });

  trace("browser.context", "Creating browser context", {
    locale: env.WAKANOW_LOCALE,
    timezoneId: env.WAKANOW_TIMEZONE
  });
  const context = await browser.newContext({
    locale: env.WAKANOW_LOCALE,
    timezoneId: env.WAKANOW_TIMEZONE,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    const results = await runHomepageFlow(page, request, timeoutMs, trace);
    return {
      provider: "wakanow",
      searchedAt: new Date().toISOString(),
      request,
      resultCount: results.length,
      results
    };
  } finally {
    trace("browser.close", "Closing browser resources");
    await safeClose(page, context, browser);
  }
}

async function runHomepageFlow(
  page: Page,
  request: FlightSearchRequest,
  timeoutMs: number,
  trace: SearchTracer
) {
  trace("page.goto", "Opening Wakanow homepage", { url: env.WAKANOW_BASE_URL });
  await page.goto(env.WAKANOW_BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });

  await page.waitForTimeout(3_000);
  await dismissPopups(page, trace);
  await page.waitForTimeout(1_000);
  await ensureFlightUiVisible(page, trace);
  await selectTripType(page, Boolean(request.returnDate), trace);
  await fillLocation(page, "departure", request.origin, trace);
  await fillLocation(page, "destination", request.destination, trace);
  await fillDates(page, request.departureDate, request.returnDate ?? null, trace);

  await submitSearch(page, trace);
  await waitForSearchOutcome(page, timeoutMs, trace);
  return extractResults(page, request.maxResults);
}

async function dismissPopups(page: Page, trace: SearchTracer) {
  const selectors = [
    "[role='dialog'] button[aria-label='Close']:visible",
    "ngb-modal-window button[aria-label='Close']:visible",
    ".modal.show button[aria-label='Close']:visible",
    "button:visible:has-text('I Agree')",
    "button:visible:has-text('Accept')",
    "button:visible:has-text('Close')"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) {
      continue;
    }

    trace("popup.dismiss", "Clicking popup control", { selector });
    await locator.click({ timeout: 2_000 }).catch(() =>
      fastClick(page, locator, trace, "popup.dismiss", { selector }).catch(() => undefined)
    );
    await page.waitForTimeout(QUICK_WAIT_MS);
  }
}

async function ensureFlightUiVisible(page: Page, trace: SearchTracer) {
  const searchButton = page.locator("button#search-link[type='submit']:visible").first();

  // The Angular app may still be bootstrapping — wait up to 10s for the search button
  const alreadyVisible = await searchButton
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (alreadyVisible) {
    trace("flight.ui", "Flight search UI is already visible");
    return;
  }

  const triggers = [
    page.locator("a").filter({ hasText: /^Flight$/i }).first(),
    page.locator("#ngb-nav-0").first(),
    page.locator("a[href='/flight'], a[href='/en-ng/flight']").first()
  ];

  for (const trigger of triggers) {
    if (!(await trigger.count())) {
      continue;
    }

    trace("flight.ui", "Activating flight tab");
    await fastClick(page, trigger, trace, "flight.ui");
    await page.waitForTimeout(PICKER_SETTLE_MS);

    if (await searchButton.count()) {
      trace("flight.ui", "Flight search UI became visible");
      return;
    }
  }

  throw new WakanowSearchError("Unable to activate the Wakanow flight search UI.");
}

async function selectTripType(page: Page, isRoundTrip: boolean, trace: SearchTracer) {
  const labels = isRoundTrip ? ["Round Trip", "Return", "Round trip"] : ["One Way", "One way"];
  trace("trip.type", "Selecting trip type", { isRoundTrip });
  await clickByText(page, labels).catch(() => undefined);
}

async function fillLocation(
  page: Page,
  field: LocationField,
  value: string,
  trace: SearchTracer
) {
  const searchTerm = normalizeLocation(value);
  const activator = getLocationActivator(page, field);
  const input = getLocationInput(page, field);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    trace("location.open", "Opening location picker", { field, searchTerm, attempt });
    await fastClick(page, activator, trace, "location.open", { field, searchTerm, attempt });
    await page.waitForTimeout(PICKER_SETTLE_MS);

    trace("location.type", "Typing location", { field, searchTerm, attempt });
    await focusInput(input);
    await input.fill("");
    await input.type(searchTerm, { delay: 30 });

    const menu = await waitForSuggestionMenu(page, trace, field, searchTerm, attempt);
    await chooseSuggestion(page, input, menu, field, searchTerm, trace, attempt);
    await page.waitForTimeout(500);

    const controlValue = collapseWhitespace(
      await getLocationControlValue(page, field).innerText().catch(() => "")
    );
    trace("location.confirm", "Checked selected location value", {
      field,
      searchTerm,
      attempt,
      controlValue: controlValue || null
    });

    if (controlValue && !/select city/i.test(controlValue)) {
      return;
    }
  }

  const controlValue = collapseWhitespace(
    await getLocationControlValue(page, field).innerText().catch(() => "")
  );
  throw new WakanowSearchError(`Wakanow did not confirm ${field} selection.`, {
    fieldName: field,
    searchTerm,
    controlValue: controlValue || null
  });
}

async function fillDates(
  page: Page,
  departureDate: string,
  returnDate: string | null,
  trace: SearchTracer
) {
  // Wakanow uses a range datepicker: click departure date first, then return date
  // to lock in the selection. Both clicks happen in one datepicker session.
  const trigger = page.locator(".control.date-control.departure a.link:visible").first();
  const datepicker = page.locator("ngb-datepicker:visible").first();

  let opened = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    trace("date.open", "Opening date picker", { departureDate, attempt });

    if (attempt <= 1) {
      await fastClick(page, trigger, trace, "date.open", { departureDate, attempt });
    } else {
      await trigger.click({ timeout: 2_000 }).catch(() => undefined);
    }

    opened = await datepicker
      .waitFor({ state: "visible", timeout: DATE_PICKER_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    trace("date.open", "Checked date picker visibility", { attempt, opened });
    if (opened) break;
    await page.waitForTimeout(QUICK_WAIT_MS);
  }

  if (!opened) {
    throw new WakanowSearchError("Wakanow date picker did not open.", { departureDate });
  }

  // Click 1: departure date
  await selectCalendarDate(page, departureDate, trace, "departure");
  await page.waitForTimeout(PICKER_SETTLE_MS);

  // Click 2: return date locks in both dates
  // For one-way, use the day after departure as a dummy return to commit the selection
  const effectiveReturn = returnDate ?? nextDay(departureDate);
  await selectCalendarDate(page, effectiveReturn, trace, "return");
  await page.waitForTimeout(PICKER_SETTLE_MS);

  const depText = collapseWhitespace(
    await page.locator(".control.date-control.departure").first().innerText().catch(() => "")
  );
  const retText = collapseWhitespace(
    await page.locator(".control.date-control.return").first().innerText().catch(() => "")
  );
  trace("date.confirm", "Checked selected date values", {
    departureDate,
    returnDate: effectiveReturn,
    depText,
    retText
  });
}

async function selectCalendarDate(
  page: Page,
  isoDate: string,
  trace: SearchTracer,
  field: DateField
) {
  const date = new Date(`${isoDate}T12:00:00`);
  const targetYear = String(date.getFullYear());
  const targetMonth = date.toLocaleString("en-US", { month: "long" });
  const targetMonthYear = `${targetMonth} ${targetYear}`;
  const targetDay = String(date.getDate());

  await ensureTargetMonthVisible(page, targetMonthYear, trace, field, isoDate);

  trace("date.select", "Clicking calendar day", {
    field,
    isoDate,
    targetDay,
    targetMonthYear
  });

  // Build the aria-label for the target date (e.g. "Saturday, April 25, 2026")
  const ariaLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  // Use Playwright's real click — DOM .click() doesn't trigger Angular's date selection
  const dayCell = page
    .locator(`ngb-datepicker div.ngb-dp-day[aria-label="${ariaLabel}"]`)
    .first();

  await dayCell.waitFor({ state: "attached", timeout: DATE_PICKER_TIMEOUT_MS }).catch(() => {
    throw new WakanowSearchError("Unable to find target date in Wakanow calendar.", {
      fieldName: field,
      isoDate,
      ariaLabel
    });
  });

  await dayCell.click({ timeout: 5_000 });
  trace("date.select", "Day clicked via Playwright", { field, isoDate, ariaLabel });
}

async function ensureTargetMonthVisible(
  page: Page,
  targetMonthYear: string,
  trace: SearchTracer,
  field: DateField,
  isoDate: string
) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    // Month names are in the header navigation, not inside .ngb-dp-month
    const visibleMonths = await page.evaluate(() => {
      const names: string[] = [];
      document.querySelectorAll("ngb-datepicker .ngb-dp-month-name").forEach((el) => {
        names.push((el.textContent ?? "").replace(/\s+/g, " ").trim());
      });
      return names;
    });

    if (visibleMonths.includes(targetMonthYear)) {
      trace("date.navigate", "Target month is visible", {
        field,
        isoDate,
        targetMonthYear,
        attempt,
        visibleMonths
      });
      return;
    }

    // Click "Next month" via page.evaluate to bypass actionability checks
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(
        "ngb-datepicker button[aria-label='Next month']"
      );
      if (!btn) return false;
      btn.click();
      return true;
    });

    if (!clicked) break;

    trace("date.navigate", "Advancing calendar month", {
      field,
      isoDate,
      targetMonthYear,
      attempt,
      visibleMonths
    });
    await page.waitForTimeout(PICKER_SETTLE_MS);
  }

  throw new WakanowSearchError("Unable to navigate Wakanow calendar to target month.", {
    fieldName: field,
    isoDate,
    targetMonthYear
  });
}

async function submitSearch(page: Page, trace: SearchTracer) {
  const button = page.locator("button#search-link[type='submit']:visible").first();
  if (!(await button.count())) {
    throw new WakanowSearchError("Unable to find the Wakanow search button.");
  }

  trace("search.button", "Submitting search");
  await fastClick(page, button, trace, "search.button");
}

async function waitForSearchOutcome(page: Page, timeoutMs: number, trace: SearchTracer) {
  trace("search.wait", "Waiting for search results page", { timeoutMs });
  await page
    .waitForURL(/\/flight\/search/i, { timeout: timeoutMs })
    .catch(() => undefined);

  trace("search.wait", "On results page, waiting for flight cards or no-results message", {
    currentUrl: page.url()
  });

  // Wait for either flight result cards (containing a price) or a "no results" message
  await Promise.race([
    page
      .locator("article, .flight-card, .flight-result, [data-testid*='flight' i]")
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs }),
    page
      .locator("text=/₦[\\d,]+|NGN[\\s\\d,]+/i")
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs }),
    page
      .locator("text=/we couldn.?t find any result|no result/i")
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
  ]).catch(() => undefined);

  trace("search.wait", "Search outcome wait finished", { currentUrl: page.url() });
}

async function extractResults(page: Page, maxResults: number) {
  const bodyText = collapseWhitespace(await page.locator("body").innerText().catch(() => ""));
  if (/we couldn.?t find any result|no result/i.test(bodyText)) {
    throw new WakanowSearchError("Wakanow returned no flight results for this query.", {
      url: page.url(),
      bodyPreview: bodyText.slice(0, 800)
    });
  }

  const cards = await page
    .locator("div.flight-fare-detail-wrap, app-flight-card, app-flight-group-card")
    .elementHandles();
  const results: FlightSearchResult[] = [];

  for (const card of cards) {
    const text = collapseWhitespace((await card.innerText().catch(() => "")) ?? "");
    if (!looksLikeFlightCard(text)) {
      continue;
    }

    results.push({
      airline: extractAirline(text),
      priceText: extractPrice(text),
      departureTime: extractNthTime(text, 0),
      arrivalTime: extractNthTime(text, 1),
      duration: extractDuration(text),
      stops: extractStops(text),
      deeplink: page.url(),
      rawText: text
    });
  }

  const deduped = dedupeResults(results).slice(0, maxResults);
  if (deduped.length === 0) {
    throw new WakanowSearchError("Unable to extract flight results from Wakanow.", {
      url: page.url(),
      bodyPreview: bodyText.slice(0, 800)
    });
  }

  return deduped;
}

function getLocationActivator(page: Page, field: LocationField) {
  if (field === "departure") {
    return page.locator(".control.from a.link.d-block:visible").first();
  }

  return page
    .locator("location-dropdown")
    .filter({ has: page.locator("#itinerary_0_destination") })
    .locator("a.link.d-block:visible")
    .first();
}

function getLocationInput(page: Page, field: LocationField) {
  return page.locator(`#itinerary_0_${field}:visible`).first();
}

function getLocationControlValue(page: Page, field: LocationField) {
  if (field === "departure") {
    return page.locator(".control.from .control-value").first();
  }

  return page
    .locator(".control")
    .filter({ has: page.locator("#itinerary_0_destination") })
    .locator(".control-value")
    .first();
}

async function waitForSuggestionMenu(
  page: Page,
  trace: SearchTracer,
  field: LocationField,
  searchTerm: string,
  attempt: number
) {
  const menu = page.locator(".dropdown-menu.no-toggle:visible").last();
  await menu.waitFor({ state: "visible", timeout: SUGGESTION_TIMEOUT_MS }).catch(() => undefined);

  for (let poll = 1; poll <= SUGGESTION_TIMEOUT_MS / SUGGESTION_POLL_MS; poll += 1) {
    const exact = menu
      .locator("a.dropdown-item")
      .filter({ hasText: new RegExp(`^${escapeRegex(searchTerm)}$`, "i") })
      .first();
    const partial = menu
      .locator("a.dropdown-item")
      .filter({ hasText: new RegExp(escapeRegex(searchTerm), "i") })
      .first();

    if ((await exact.count()) || (await partial.count())) {
      trace("location.wait", "Suggestions are ready", {
        field,
        searchTerm,
        attempt,
        poll
      });
      return menu;
    }

    await page.waitForTimeout(SUGGESTION_POLL_MS);
  }

  trace("location.wait", "Suggestion list did not fully populate in time", {
    field,
    searchTerm,
    attempt
  });
  return menu;
}

async function chooseSuggestion(
  page: Page,
  input: Locator,
  menu: Locator,
  field: LocationField,
  searchTerm: string,
  trace: SearchTracer,
  attempt: number
) {
  const exact = menu
    .locator("a.dropdown-item")
    .filter({ hasText: new RegExp(`^${escapeRegex(searchTerm)}$`, "i") })
    .first();
  const partial = menu
    .locator("a.dropdown-item")
    .filter({ hasText: new RegExp(escapeRegex(searchTerm), "i") })
    .first();

  if (await exact.count()) {
    trace("location.select", "Selecting exact suggestion", { field, searchTerm, attempt });
    await fastClick(page, exact, trace, "location.select", { field, searchTerm, attempt });
    return;
  }

  if (await partial.count()) {
    trace("location.select", "Selecting partial suggestion", { field, searchTerm, attempt });
    await fastClick(page, partial, trace, "location.select", { field, searchTerm, attempt });
    return;
  }

  trace("location.select", "Falling back to keyboard selection", { field, searchTerm, attempt });
  await input.press("ArrowDown").catch(() => undefined);
  await input.press("Enter").catch(() => undefined);
}

async function clickByText(page: Page, labels: string[]) {
  for (const label of labels) {
    const locator = page
      .locator("button, a, div, span, label")
      .filter({ hasText: new RegExp(label, "i") })
      .first();

    if (await locator.count()) {
      await locator.click({ timeout: 1_000 }).catch(() => undefined);
      return;
    }
  }
}

async function focusInput(locator: Locator) {
  await locator
    .evaluate((element) => {
      if (element instanceof HTMLInputElement) {
        element.focus();
        element.select();
      }
    })
    .catch(() => undefined);
}

async function fastClick(
  page: Page,
  locator: Locator,
  trace?: SearchTracer,
  step = "click",
  data?: Record<string, unknown>
) {
  await locator.waitFor({ state: "visible", timeout: 1_000 }).catch(() => undefined);

  const domClicked = await locator
    .evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      element.click();
      return true;
    })
    .catch(() => false);

  if (domClicked) {
    trace?.(step, "Dispatched DOM click", data);
    return;
  }

  const clicked = await locator.click({ force: true, timeout: 500 }).then(() => true).catch(
    () => false
  );
  if (clicked) {
    trace?.(step, "Dispatched Playwright click", data);
    return;
  }

  const box = await locator.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined);
    trace?.(step, "Dispatched mouse click", {
      ...data,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });
    return;
  }

  throw new WakanowSearchError("Unable to click required Wakanow control.", data);
}

function normalizeLocation(value: string) {
  const trimmed = value.trim();
  return LOCATION_ALIASES[trimmed.toUpperCase()] ?? trimmed;
}

function nextDay(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeFlightCard(text: string) {
  return /\b\d{1,2}:\d{2}\b/.test(text) && /(₦|NGN|USD|\$|AED|GBP|EUR)/i.test(text);
}

function extractPrice(text: string) {
  return text.match(/(?:₦|NGN|USD|\$|AED|GBP|EUR)\s?[\d,]+(?:\.\d{2})?/i)?.[0] ?? null;
}

function extractAirline(text: string) {
  // Match airline names even when adjacent to other text (e.g. "AeroFull Pay")
  return (
    text.match(
      /(Arik Air|Air Peace|Ibom Air|United Nigeria|ValueJet|Green Africa|Dana Air|Overland Airways|Qatar Airways|Emirates|British Airways|Ethiopian Airlines|Kenya Airways|RwandAir|Turkish Airlines|Lufthansa|KLM|Air France|Aero)/i
    )?.[0] ?? null
  );
}

function extractNthTime(text: string, index: number) {
  // Card format: "Depart 07:30 AMAero07:30Lagos1h 15m Non stop 08:45Abuja"
  // Times: [header, departure, arrival] — we want departure (1) and arrival (2)
  const departSection = text.match(/Depart\s+([\s\S]*?)(?:Return|$)/i)?.[1] ?? text;
  const times = departSection.match(/\d{1,2}:\d{2}/g) ?? [];
  // Skip the header duplicate — departure is index 1, arrival is index 2
  const offset = times.length >= 3 ? 1 : 0;
  return times[index + offset] ?? null;
}

function extractDuration(text: string) {
  const departSection = text.match(/Depart\s+([\s\S]*?)(?:Return|$)/i)?.[1] ?? text;
  return departSection.match(/\d+h\s*(?:\d+m)?/i)?.[0]?.trim() ?? null;
}

function extractStops(text: string) {
  const departSection = text.match(/Depart\s+([\s\S]*?)(?:Return|$)/i)?.[1] ?? text;
  return departSection.match(/non[-\s]?stop|\d+\s+stop(?:s)?/i)?.[0] ?? null;
}

function dedupeResults(results: FlightSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = [
      result.airline,
      result.priceText,
      result.departureTime,
      result.arrivalTime,
      result.duration
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createTracer(options: SearchRuntimeOptions): SearchTracer {
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
