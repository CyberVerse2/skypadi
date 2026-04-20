import path from "node:path";
import { promises as fs } from "node:fs";
import { env } from "../../config.js";
import type { Passenger } from "../../schemas/flight-booking.js";
import type {
  BankTransferDetails,
  BookingContactContext,
  BookingVerificationMode,
  BookingVerificationStatus,
  ConfirmationEmail,
  BookingFlightSummary
} from "../../schemas/booking-contract.js";
import type { Browser, BrowserContext, Locator, Page } from "patchright";
import {
  launchStealthBrowser,
  createStealthContext,
  saveSessionState,
  detectChallenge,
  humanClick,
  humanPause,
  humanType
} from "./stealth.js";
import * as agentmail from "../agentmail.js";
import type { Inbox, AgentMailMessage } from "../agentmail.js";

const SESSION_STATE_PATH = path.resolve(process.cwd(), ".wakanow-session.json");
const TRACE_DIR = path.resolve(process.cwd(), "traces");
const FIXTURE_DIR = path.resolve(process.cwd(), "fixtures");
const INBOX_ROTATION_STATE_PATH = path.resolve(process.cwd(), ".agentmail-inbox-rotation.json");

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
  /** Called when the provider asks for email verification code. Return the code string. */
  onVerificationCode?: (email: string) => Promise<string>;
  /** Called to update the user on booking progress */
  onProgress?: (step: string) => Promise<void>;
};

export type ApiBookingResponse = {
  provider: "wakanow";
  bookedAt: string;
  bookingId: string;
  status: "pending_payment";
  paymentUrl: string;
  bankTransfers?: BankTransferDetails[];
  confirmationEmail?: ConfirmationEmail;
  contactContext: BookingContactContext;
  flightSummary: BookingFlightSummary;
};

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  console.log(`[api-book] Launching Chrome ${env.PROXY_URL ? `via proxy ${new URL(env.PROXY_URL).hostname}` : "(no proxy)"}`);
  sharedBrowser = await launchStealthBrowser({
    headless: env.WAKANOW_HEADLESS,
    proxyUrl: env.PROXY_URL
  });
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
  const { searchKey, deeplink, onProgress } = request;
  const currency = env.WAKANOW_CURRENCY;
  const notify = (msg: string) => onProgress?.(msg) ?? Promise.resolve();
  const customerEmail = request.passenger.email;

  console.log(`[api-book] Starting booking...`);
  await notify("✈️ Starting your booking...");

  // Use an AgentMail inbox when configured so we can auto-solve OTPs and pull
  // the post-booking confirmation email without user involvement.
  // Prefer a persistent shared inbox via AGENTMAIL_INBOX_ID so we don't hit tier limits.
  const passenger: Passenger = { ...request.passenger };
  let inbox: Inbox | undefined;
  let inboxIsPersistent = false;
  let verificationStatus: BookingVerificationStatus = "not_needed";
  const bookingStartedAt = new Date().toISOString();
  if (agentmail.isConfigured()) {
    const persistentInbox = await getPersistentInbox();
    if (persistentInbox) {
      inbox = persistentInbox;
      inboxIsPersistent = true;
      console.log(`[api-book] AgentMail inbox (persistent): ${inbox.email}`);
    } else {
      inbox = await agentmail.createInbox(`SkyPadi ${Date.now()}`);
      console.log(`[api-book] AgentMail inbox (disposable): ${inbox.email}`);
    }
    passenger.email = inbox.email;
    await notify("⏳ Preparing your booking...");
  }

  const recordHarPath = process.env.HAR_RECORD ? path.join(FIXTURE_DIR, `booking-${Date.now()}.har`) : undefined;
  const replayHarPath = process.env.HAR_REPLAY_PATH;
  if (recordHarPath) {
    await fs.mkdir(FIXTURE_DIR, { recursive: true });
    console.log(`[api-book] HAR recording → ${recordHarPath}`);
  }
  if (replayHarPath) console.log(`[api-book] HAR replay ← ${replayHarPath} (offline mode)`);

  const browser = await getBrowser();
  const context = await createStealthContext(browser, {
    geolocation: "lagos",
    sessionStatePath: SESSION_STATE_PATH,
    recordHarPath,
    replayHarPath,
    blockAssets: process.env.BLOCK_ASSETS !== "false"
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  const debugScreenshots: Buffer[] = [];

  try {
    const page = await context.newPage();
    const captured = attachApiCapture(page);

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
      }
    }

    // Detect anti-bot challenge pages early so we fail loud instead of hanging
    await humanPause(600, 1200);
    const challenge = await detectChallenge(page);
    if (challenge) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) debugScreenshots.push(shot);
      console.log(`[api-book] Challenge detected: ${challenge}`);
      throw new Error(`Blocked by anti-bot: ${challenge}. Set CAPSOLVER_API_KEY or retry with a fresh proxy session.`);
    }

    await dismissCookieConsent(page);

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
      await humanClick(bookBtn, { timeout: 30_000 });
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
      const modalText = await page.evaluate((selector) => document.querySelector(selector)?.textContent?.slice(0, 200) ?? "", ACTIVE_MODAL_SELECTOR).catch(() => "");
      throw new Error(modalText || `Failed to reach customer-info. URL: ${page.url()}`);
    }

    const bookingId = page.url().match(/\/booking\/(\d+)\//)?.[1];
    if (!bookingId) throw new Error("Could not extract BookingId");
    console.log(`[api-book] BookingId: ${bookingId}, ${captured.airline} ${captured.departure}→${captured.arrival}`);
    await page.locator("[name='booking_lastname']").first().waitFor({ state: "visible", timeout: 30_000 });

    console.log(`[api-book] Filling form...`);
    await notify("✅ Flight selected\n⏳ Filling in your passenger details...");
    await fillCustomerInfoForm(page, passenger);

    // Step 4: Click Continue — Angular handles Validate + navigation
    console.log(`[api-book] Submitting form...`);
    await notify("✅ Details filled\n⏳ Submitting your booking to Wakanow... (usually ~15s)");
    await humanClick(page.locator("button:has-text('Continue'), a:has-text('Continue')").first(), { timeout: 30_000 });
    await waitForSubmitOutcome(page);

    if (page.url().includes("/customer-info")) {
      verificationStatus = await handlePostSubmitModal(
        page,
        request,
        customerEmail,
        passenger,
        inbox,
        debugScreenshots,
        notify,
        captured,
        verificationStatus
      );
    }

    // Wait for navigation to complete
    await page.waitForURL(url => !url.toString().includes("/customer-info"), { timeout: 30_000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    console.log(`[api-book] After submit: ${page.url()}`);

    // Step 5: Addons page → Pay Now
    if (page.url().includes("/addons")) {
      await notify("✅ Booking submitted\n⏳ Skipping add-ons...");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await humanClick(page.locator("text=/pay\\s*now/i").first(), { timeout: 15_000 }).catch(() => {});
      await page.waitForURL(/\/payment/i, { timeout: 30_000 }).catch(() => {});
    }

    // Step 6: Payment page → Bank Transfer → Continue
    console.log(`[api-book] Payment page: ${page.url()}`);
    await notify("✅ Almost there\n⏳ Getting payment details...");
    await waitForAnyVisible(page, [
      "text=/bank.?transfer/i",
      "text=/continue.*bank/i",
      "text=/continue.*transfer/i",
      "button:has-text('Continue')"
    ], 30_000);

    // Click Bank Transfer
    const bankBtn = page.locator("text=/bank.?transfer/i").first();
    if (await bankBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await humanClick(bankBtn);
      await waitForAnyVisible(page, [
        "text=/continue.*bank/i",
        "text=/continue.*transfer/i",
        "button:has-text('Continue')",
        "text=/account number/i"
      ], 15_000).catch(() => {});
    }

    // Click Continue to see bank details — triggers GeneratePNR + MakePayment
    const continueCandidates = [
      page.locator("text=/continue.*bank/i").first(),
      page.locator("text=/continue.*transfer/i").first(),
      page.locator("button:has-text('Continue')").first()
    ];
    const continueBtn = await findFirstVisibleLocator(continueCandidates);
    if (continueBtn) {
      console.log(`[api-book] Clicking Continue for bank details...`);
      await humanClick(continueBtn);
      await Promise.race([
        page.waitForResponse((response) => /GeneratePNR|MakePayment|Payment/i.test(response.url()), { timeout: 30_000 }),
        waitForAnyVisible(page, ["text=/account number/i", "text=/beneficiary/i"], 30_000)
      ]).catch(() => {});
    }

    // Success gate: Wakanow commits the booking only once GeneratePNR/MakePayment fire
    // and return bank transfer details. Until then `bookingId` is just a pre-allocated
    // record from customer-info and does NOT represent a real booking. Without this gate
    // we silently claim success and waste 3 min polling for a confirmation that never arrives.
    const reachedPayment = /\/payment/i.test(page.url()) && captured.bankTransfers.length > 0;
    if (!reachedPayment) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) debugScreenshots.push(shot);
      throw new Error(
        `Booking did not commit: url=${page.url()}, bankTransfers=${captured.bankTransfers.length}, airline="${captured.airline}"`
      );
    }

    console.log(`[api-book] Booking complete! ID: ${bookingId}, ${captured.bankTransfers.length} bank(s), ₦${captured.totalPrice.toLocaleString()}`);
    await notify("✅ Booking complete!");

    // Persist the session state so subsequent bookings can reuse any CF/anti-bot
    // clearance cookies — this is the single biggest defense against intermittent blocks.
    await saveSessionState(context, SESSION_STATE_PATH);

    await page.close();

    const confirmationEmail = inbox ? await pollConfirmationEmail(inbox, bookingStartedAt, notify) : undefined;

    const paymentUrl = `https://www.wakanow.com/en-ng/booking/${bookingId}/payment?products=Flight&reqKey=${searchKey}`;

    return {
      provider: "wakanow",
      bookedAt: new Date().toISOString(),
      bookingId,
      status: "pending_payment",
      paymentUrl,
      bankTransfers: captured.bankTransfers.length > 0 ? captured.bankTransfers : undefined,
      confirmationEmail,
      contactContext: {
        customerEmail,
        bookingContactEmail: passenger.email,
        verificationMode: inbox ? "internal_contact" : "customer_contact",
        verificationStatus
      },
      flightSummary: {
        airline: captured.airline,
        departure: captured.departure,
        arrival: captured.arrival,
        departureTime: captured.departureTime,
        arrivalTime: captured.arrivalTime,
        price: captured.totalPrice,
        currency
      }
    };
  } catch (e: any) {
    console.log(`[api-book] Failed: ${e.message}`);
    const tracePath = await saveTraceOnFailure(context);
    if (tracePath) console.log(`[api-book] Trace saved: ${tracePath} — inspect with 'npx playwright show-trace ${tracePath}'`);
    throw new WakanowApiBookingError(
      `Booking failed: ${e.message}`,
      { tracePath },
      (e as any).debugScreenshots ?? debugScreenshots
    );
  } finally {
    await context.tracing.stop().catch(() => undefined);
    await context.close();
    // Only delete disposable (per-booking) inboxes. Persistent shared inboxes (pinned via
    // AGENTMAIL_INBOX_ID) are kept — they're shared across bookings.
    if (inbox && !inboxIsPersistent) {
      await agentmail.deleteInbox(inbox.id).catch((err) => console.log(`[api-book] inbox cleanup failed: ${err.message}`));
    }
  }
}

async function getPersistentInbox(): Promise<Inbox | undefined> {
  const raw = env.AGENTMAIL_INBOX_ID?.trim();
  if (!raw) return undefined;

  const inboxIds = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (inboxIds.length === 0) return undefined;
  if (inboxIds.length === 1) {
    return { id: inboxIds[0], email: inboxIds[0] };
  }

  let nextIndex = 0;
  try {
    const persisted = JSON.parse(await fs.readFile(INBOX_ROTATION_STATE_PATH, "utf8")) as { nextIndex?: number };
    if (typeof persisted.nextIndex === "number" && Number.isFinite(persisted.nextIndex)) {
      nextIndex = persisted.nextIndex % inboxIds.length;
    }
  } catch {
    // No previous state yet — start from the first inbox.
  }

  const selected = inboxIds[nextIndex];
  const followingIndex = (nextIndex + 1) % inboxIds.length;
  await fs.writeFile(INBOX_ROTATION_STATE_PATH, JSON.stringify({ nextIndex: followingIndex }), "utf8").catch(() => undefined);
  return { id: selected, email: selected };
}

async function saveTraceOnFailure(context: BrowserContext): Promise<string | undefined> {
  try {
    await fs.mkdir(TRACE_DIR, { recursive: true });
    const file = path.join(TRACE_DIR, `booking-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
    await context.tracing.stop({ path: file });
    return file;
  } catch (e: any) {
    console.log(`[api-book] trace save failed: ${e.message}`);
    return undefined;
  }
}

/** Dismiss Wakanow's cookie consent. Two-pronged:
 *  1. Click the accept button via JS (avoids Playwright pointer-event issues with overlays).
 *  2. Nuke the banner's container from the DOM — removes its click-blocking overlay even if (1)
 *     didn't persist the consent cookie. The server-side session gets the cookie from our addCookies
 *     setup anyway. */
async function dismissCookieConsent(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a"));
    const accept = buttons.find((b) =>
      /yes,?\s*i\s*agree|accept all|i\s*accept/i.test(b.textContent ?? "")
    );
    if (!accept) return { found: false, containerInfo: null };

    (accept as HTMLElement).click();

    // Walk up from the accept button to find the banner container, then hide it.
    // Safer than generic class-name matching (Wakanow's banner uses non-standard names).
    let container: HTMLElement | null = accept as HTMLElement;
    while (container && !/we use cookies/i.test((container.textContent ?? "").slice(0, 400))) {
      container = container.parentElement;
    }
    if (container && container !== document.body && container !== document.documentElement) {
      container.style.display = "none";
      container.style.pointerEvents = "none";
    }
    return {
      found: true,
      containerInfo: container ? `${container.tagName}.${container.className}#${container.id}` : null
    };
  }).catch(() => ({ found: false, containerInfo: null }));

  if (result.found) console.log(`[api-book] Cookie banner dismissed (container: ${result.containerInfo})`);
  else console.log(`[api-book] Cookie accept button not found — proceeding`);
  await page.waitForTimeout(500);
}

async function selectOption(locator: Locator, value: string): Promise<void> {
  const normalized = value.trim();
  const numeric = String(Number.parseInt(normalized, 10));
  const candidates = [
    { label: normalized },
    { value: normalized },
    normalized
  ];
  if (numeric !== "NaN" && numeric !== normalized) {
    candidates.push({ label: numeric }, { value: numeric }, numeric);
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await locator.selectOption(candidate as Parameters<Locator["selectOption"]>[0]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function waitForAnyVisible(page: Page, selectors: string[], timeout: number): Promise<void> {
  await Promise.any(
    selectors.map((selector) => page.locator(selector).first().waitFor({ state: "visible", timeout }))
  );
}

const ACTIVE_MODAL_SELECTOR = "ngb-modal-window.d-block.modal.show, .modal.show:not([aria-hidden='true']), .swal2-container.swal2-backdrop-show";

async function waitForSubmitOutcome(page: Page, timeout = 30_000): Promise<void> {
  await Promise.race([
    page.waitForURL((url) => !url.toString().includes("/customer-info"), { timeout }),
    waitForAnyVisible(page, [
      "ngb-modal-window.d-block.modal.show",
      ".modal.show:not([aria-hidden='true'])",
      ".swal2-container.swal2-backdrop-show",
      ".swal2-container",
      ".spinner-border",
      ".spinner-grow",
      ".loading",
      ".loader",
      ".busy",
      ".modal-backdrop"
    ], timeout)
  ]).catch(() => {});
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

type CapturedFlightData = {
  airline: string;
  departure: string;
  arrival: string;
  departureTime: string;
  arrivalTime: string;
  totalPrice: number;
  bankTransfers: BankTransferDetails[];
  validationMessage?: string;
  validationStatus?: number;
};

function attachApiCapture(page: Page): CapturedFlightData {
  const data: CapturedFlightData = {
    airline: "", departure: "", arrival: "",
    departureTime: "", arrivalTime: "",
    totalPrice: 0,
    bankTransfers: [],
    validationMessage: undefined,
    validationStatus: undefined
  };
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("wakanow.com")) return;
    const req = res.request();
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
    try {
      if (!res.headers()["content-type"]?.includes("json")) return;
      const body = await res.json() as any;

      if (url.includes("/flights/Select/") && body?.FlightSummary) {
        const flight = body.FlightSummary.FlightCombination?.Flights?.[0];
        if (flight) {
          data.airline = flight.AirlineName ?? "";
          data.departure = flight.DepartureCode ?? "";
          data.arrival = flight.ArrivalCode ?? "";
          data.departureTime = flight.DepartureTime ?? "";
          data.arrivalTime = flight.ArrivalTime ?? "";
          data.totalPrice = body.FlightSummary.FlightCombination?.Price?.Amount ?? 0;
        }
      }
      if (body?.PaymentResponseModel) {
        if (body.PaymentResponseModel.TotalPrice?.Amount) data.totalPrice = body.PaymentResponseModel.TotalPrice.Amount;
        const parsed = parseBankTransfers(body.PaymentResponseModel);
        if (parsed.length > 0) data.bankTransfers = parsed;
      }
      if (/\/Booking\/Validate/i.test(url) && typeof body?.Message === "string") {
        data.validationMessage = body.Message.trim();
        data.validationStatus = res.status();
        console.log(`[api-book] Validate message: ${data.validationMessage}`);
      }
      if (/\/Booking\/|\/Payment\/|\/GeneratePNR/.test(url)) {
        console.log(`[api-book] API: ${req.method()} ${url.split("?")[0].slice(-60)} → ${res.status()}`);
      }
    } catch { /* non-JSON or parse failure — ignore */ }
  });
  return data;
}

async function fillCustomerInfoForm(page: Page, passenger: Passenger): Promise<void> {
  const phone = passenger.phone.startsWith("+") ? passenger.phone.replace(/^\+234/, "0") : passenger.phone;

  await humanType(page.locator("[name='booking_lastname']").first(), passenger.lastName);
  await humanType(page.locator("[name='booking_firstname']").first(), passenger.firstName);
  if (passenger.middleName) {
    await humanType(page.locator("[name='booking_middlename']").first(), passenger.middleName).catch(() => {});
  }
  await selectOption(page.locator("select").first(), passenger.title);

  await fillDobPicker(page, passenger.dateOfBirth);

  await setGender(page, passenger.gender);

  await humanType(page.locator("[name='PhoneNumber']").first(), phone);
  await humanType(page.locator("input[type='email']").first(), passenger.email);

  const terms = page.locator("#acceptTermsAndCondition");
  if (!(await terms.isChecked().catch(() => false))) {
    await terms.click().catch(() => terms.evaluate((el) => (el as any).click()));
  }
}

async function fillDobPicker(page: Page, dateOfBirth: string): Promise<void> {
  const [year, month, day] = dateOfBirth.split("-");
  const dobInput = page.locator("input[placeholder='yyyy-mm-dd']").first();
  const calBtn = dobInput.locator("..").locator("button:has(.fa-calendar), button.btn-outline-dark").first();
  await ((await calBtn.count()) ? calBtn : dobInput).click();
  await page.locator("ngb-datepicker").first().waitFor({ state: "visible", timeout: 5_000 });

  const selects = page.locator("ngb-datepicker select");
  if (await selects.count() >= 2) {
    await selectOption(selects.nth(1), year);
    await selectDobMonth(page, month);
    const clickedDay = await page.evaluate((d) => {
      for (const cell of document.querySelectorAll("ngb-datepicker div.ngb-dp-day")) {
        if ((cell.textContent ?? "").trim() === d && !cell.classList.contains("ngb-dp-day--outside")) {
          (cell as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, String(parseInt(day, 10)));
    if (!clickedDay) throw new Error(`DOB day ${day} not available in datepicker`);
  }
  await dobInput.waitFor({ state: "visible", timeout: 5_000 });
}

async function selectDobMonth(page: Page, month: string): Promise<void> {
  const monthIndex = Number.parseInt(month, 10);
  const monthSelect = page.locator("ngb-datepicker select").nth(0);
  const monthNames = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  const options = [
    String(monthIndex),
    String(monthIndex - 1),
    month.padStart(2, "0"),
    monthNames[monthIndex - 1]
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const option of options) {
    try {
      await selectOption(monthSelect, option);
      const selected = await monthSelect.inputValue().catch(() => "");
      if ([String(monthIndex), String(monthIndex - 1), month.padStart(2, "0")].includes(selected)) return;
      const selectedLabel = await monthSelect.locator("option:checked").textContent().catch(() => "");
      if ((selectedLabel ?? "").toLowerCase().includes((monthNames[monthIndex - 1] ?? "").toLowerCase())) return;
    } catch (error) {
      lastError = error;
    }
  }

  const clicked = await page.evaluate((targetMonth) => {
    const monthSelectEl = document.querySelector("ngb-datepicker select") as HTMLSelectElement | null;
    if (!monthSelectEl) return false;
    const monthNamesLocal = ["january", "february", "march", "april", "may", "june", "july",
      "august", "september", "october", "november", "december"];
    const desiredValues = new Set([
      String(targetMonth),
      String(targetMonth - 1),
      String(targetMonth).padStart(2, "0")
    ]);
    for (const option of Array.from(monthSelectEl.options)) {
      const label = option.textContent?.trim().toLowerCase() ?? "";
      if (desiredValues.has(option.value) || label.includes(monthNamesLocal[targetMonth - 1] ?? "")) {
        monthSelectEl.value = option.value;
        monthSelectEl.dispatchEvent(new Event("input", { bubbles: true }));
        monthSelectEl.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, monthIndex);

  if (!clicked) throw lastError ?? new Error(`Could not select DOB month ${month}`);
}

async function setGender(page: Page, gender: Passenger["gender"]): Promise<void> {
  const normalized = gender.toLowerCase();
  const selectors = normalized === "male"
    ? ["#Male0", "label[for='Male0']", "input[value='Male']", "input[name*='gender'][value='Male']"]
    : ["#Female0", "label[for='Female0']", "input[value='Female']", "input[name*='gender'][value='Female']"];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    try {
      await locator.click({ timeout: 5_000 });
      if (await isGenderSelected(page, normalized)) return;
    } catch {
      // Fall through to JS-based click path below.
    }
  }

  const selected = await page.evaluate((targetGender) => {
    const candidates = Array.from(document.querySelectorAll("input, label"));
    for (const node of candidates) {
      const text = (node.textContent ?? "").trim().toLowerCase();
      const input = node instanceof HTMLInputElement ? node : null;
      const htmlFor = node instanceof HTMLLabelElement ? node.htmlFor : null;
      const candidateInput = input
        ?? (htmlFor ? document.getElementById(htmlFor) as HTMLInputElement | null : null)
        ?? (node.querySelector?.("input") as HTMLInputElement | null);
      const matchesTarget = text.includes(targetGender)
        || candidateInput?.id.toLowerCase().includes(targetGender)
        || candidateInput?.value.toLowerCase() === targetGender;
      if (!candidateInput || !matchesTarget) continue;
      candidateInput.checked = true;
      candidateInput.click();
      candidateInput.dispatchEvent(new Event("input", { bubbles: true }));
      candidateInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, normalized);

  if (!selected || !(await isGenderSelected(page, normalized))) {
    throw new Error(`Could not select gender ${gender}`);
  }
}

async function isGenderSelected(page: Page, gender: string): Promise<boolean> {
  return page.evaluate((targetGender) => {
    const inputs = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']")) as HTMLInputElement[];
    return inputs.some((input) => {
      const label = (document.querySelector(`label[for="${input.id}"]`)?.textContent ?? "").trim().toLowerCase();
      return input.checked && (
        input.id.toLowerCase().includes(targetGender)
        || input.value.toLowerCase() === targetGender
        || label.includes(targetGender)
      );
    });
  }, gender).catch(() => false);
}

async function handlePostSubmitModal(
  page: Page,
  request: ApiBookingRequest,
  customerEmail: string,
  passenger: Passenger,
  inbox: Inbox | undefined,
  debugScreenshots: Buffer[],
  notify: (msg: string) => Promise<void>,
  captured: CapturedFlightData,
  verificationStatus: BookingVerificationStatus
): Promise<BookingVerificationStatus> {
  const shot = await page.screenshot({ fullPage: true }).catch(() => null);
  if (shot) debugScreenshots.push(shot);

  const overlayState = await inspectSubmitOverlay(page);
  const { modalText, visibleButtons, loadingIndicators, validationMessages } = overlayState;
  if (loadingIndicators.length > 0) {
    console.log(`[api-book] Loading indicators: ${JSON.stringify(loadingIndicators)}`);
  }
  const meaningfulValidationMessages = validationMessages.filter(isMeaningfulValidationMessage);
  if (meaningfulValidationMessages.length > 0) {
    console.log(`[api-book] Validation messages: ${JSON.stringify(meaningfulValidationMessages)}`);
  }
  if (captured.validationMessage) {
    console.log(`[api-book] Captured validation response: ${captured.validationMessage}`);
  }

  console.log(`[api-book] Stuck on customer-info. Modal: ${modalText ?? "none"}`);
  console.log(`[api-book] Buttons: ${JSON.stringify(visibleButtons)}`);

  if (loadingIndicators.length > 0 || (!modalText && visibleButtons.length === 0)) {
    const resolved = await waitForLoadingStateToSettle(page, 20_000);
    if (resolved !== "still-loading") return verificationStatus;
  }

  const verificationSignal = await waitForVerificationSignal(page, captured, 6_000);

  const { modalText: refreshedModalText, visibleButtons: refreshedVisibleButtons } = await page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    return {
      modalText: modal ? (modal as HTMLElement).innerText?.trim().slice(0, 300) : null,
      visibleButtons: Array.from(document.querySelectorAll("button, a.btn"))
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map((b) => (b as HTMLElement).innerText?.trim().slice(0, 40))
        .filter(Boolean)
    };
  }, ACTIVE_MODAL_SELECTOR).catch(() => ({ modalText: modalText ?? null as string | null, visibleButtons: visibleButtons as string[] }));

  const effectiveModalText = refreshedModalText ?? modalText;
  const effectiveVisibleButtons = refreshedVisibleButtons.length > 0 ? refreshedVisibleButtons : visibleButtons;
  const verificationHint = [effectiveModalText, captured.validationMessage, ...meaningfulValidationMessages]
    .filter(Boolean)
    .join(" ");
  const needsVerification = verificationSignal || /verif|code|otp|validate your email/i.test(verificationHint);
  const continueBtn = page.locator("button:has-text('Continue'), a:has-text('Continue')").first();
  const modalRoot = page.locator(ACTIVE_MODAL_SELECTOR).first();

  if (needsVerification) {
    await notify("⏳ Finalizing your booking details...");
    const verification = await resolveVerificationCode(request, customerEmail, passenger, inbox, notify);
    verificationStatus = verification.status;
    const code = verification.code;
    if (!code) {
      const err: any = new Error(`Verification code required but no resolver available (set AGENTMAIL_API_KEY or provide onVerificationCode)`);
      err.debugScreenshots = debugScreenshots;
      throw err;
    }
    console.log(`[api-book] Entering verification code...`);

    await waitForAnyVisible(page, OTP_INPUT_SELECTORS, 15_000).catch(() => {});

    const otpFilled = await fillVerificationCode(page, code);
    if (otpFilled) {
      const verifyBtn = await findFirstVisibleLocator([
        page.locator(".modal button:has-text('Verify')").first(),
        page.locator(".modal button:has-text('Submit')").first(),
        page.locator(".modal button:has-text('Continue')").first(),
        page.locator("ngb-modal-window button:has-text('Verify')").first(),
        page.locator("ngb-modal-window button:has-text('Submit')").first(),
        page.locator("ngb-modal-window button:has-text('Continue')").first(),
        page.locator("[role='dialog'] button:has-text('Verify')").first(),
        page.locator("[role='dialog'] button:has-text('Submit')").first(),
        page.locator("[role='dialog'] button:has-text('Continue')").first()
      ]);
      if (verifyBtn) {
        await humanClick(verifyBtn).catch(() => verifyBtn.click());
        await waitForSubmitOutcome(page);
      } else {
        const clicked = await clickVisibleVerificationButton(page);
        if (clicked) {
          await waitForSubmitOutcome(page);
        }
      }
    } else {
      const err: any = new Error("Verification code inputs were not found in the modal");
      err.debugScreenshots = debugScreenshots;
      throw err;
    }
    if (page.url().includes("/customer-info")) {
      const verificationSettled = await waitForVerificationModalToSettle(page, captured.validationStatus === 200 ? 15_000 : 5_000);
      const modalStillVisible = verificationSettled === "open";
      if (!modalStillVisible) {
        await waitForSubmitOutcome(page, 15_000);
      } else if (captured.validationStatus === 200) {
        const hasOtpInputs = await hasVisibleOtpInput(page);
        if (!hasOtpInputs) {
          await humanClick(continueBtn, { timeout: 10_000 }).catch(() => continueBtn.click({ timeout: 10_000 }));
          await waitForSubmitOutcome(page, 15_000);
        } else {
          const loadingState = await waitForLoadingStateToSettle(page, 10_000);
          if (loadingState === "navigated") {
            await waitForSubmitOutcome(page, 15_000);
          }
        }
      }
      if (page.url().includes("/customer-info")) {
        const modalVisibleAfterWait = await modalRoot.isVisible({ timeout: 1_000 }).catch(() => false);
        if (modalVisibleAfterWait) {
          const err: any = new Error("Verification modal is still open after entering code");
          err.debugScreenshots = debugScreenshots;
          throw err;
        }
      }
      if (page.url().includes("/customer-info") && !await modalRoot.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await waitForSubmitOutcome(page, 15_000);
      }
      if (page.url().includes("/customer-info") && await modalRoot.isVisible({ timeout: 1_000 }).catch(() => false)) {
        const err: any = new Error("Verification modal is still open after entering code");
        err.debugScreenshots = debugScreenshots;
        throw err;
      }
    }
    return verificationStatus;
  } else if (meaningfulValidationMessages.length > 0) {
    const err: any = new Error(`Booking blocked on customer-info. Validation: ${meaningfulValidationMessages.join(" | ")}`);
    err.debugScreenshots = debugScreenshots;
    throw err;
  } else if ((effectiveModalText && effectiveModalText.trim()) || (await modalRoot.count().catch(() => 0))) {
    const applied = await resolveNonVerificationModal(page, effectiveVisibleButtons);
    if (applied) {
      await waitForSubmitOutcome(page, 15_000);
    }
    if (page.url().includes("/customer-info")) {
      const modalStillVisible = await modalRoot.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!modalStillVisible) {
        await humanClick(continueBtn, { timeout: 10_000 }).catch(() => continueBtn.click({ timeout: 10_000 }));
        await waitForSubmitOutcome(page);
      }
    }
    return verificationStatus;
  }

  if (page.url().includes("/customer-info")) {
    const err: any = new Error(`Booking blocked on customer-info. ${effectiveModalText ?? captured.validationMessage ?? "Loading overlay or no popup detected"}`);
    err.debugScreenshots = debugScreenshots;
    throw err;
  }
  return verificationStatus;
}

async function inspectSubmitOverlay(page: Page): Promise<{
  modalText: string | null;
  visibleButtons: string[];
  loadingIndicators: string[];
  validationMessages: string[];
}> {
  return page.evaluate((selector) => {
    const modal = document.querySelector(selector);

    const loadingIndicators = Array.from(document.querySelectorAll(
      ".spinner-border, .spinner-grow, .loading, .loader, .busy, .modal-backdrop, [aria-busy='true']"
    ))
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const element = node as HTMLElement;
        const classes = Array.from(element.classList).join(".");
        const aria = element.getAttribute("aria-label") ?? element.getAttribute("aria-describedby") ?? "";
        return [element.tagName.toLowerCase(), classes, aria].filter(Boolean).join(":");
      });

    const validationMessages: string[] = [];
    for (const selector of [".invalid-feedback", ".text-danger", ".error", "[role='alert']"]) {
      const matches = Array.from(document.querySelectorAll(selector))
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => (node.textContent ?? "").trim())
        .filter(Boolean);
      validationMessages.push(...matches);
    }

    return {
      modalText: modal ? (modal as HTMLElement).innerText?.trim().slice(0, 300) : null,
      visibleButtons: Array.from(document.querySelectorAll("button, a.btn"))
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map((b) => (b as HTMLElement).innerText?.trim().slice(0, 40))
        .filter(Boolean),
      loadingIndicators,
      validationMessages
    };
  }, ACTIVE_MODAL_SELECTOR).catch(() => ({
    modalText: null,
    visibleButtons: [],
    loadingIndicators: [],
    validationMessages: []
  }));
}

async function findFirstVisibleLocator(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 5_000 }).catch(() => false)) return locator;
  }
  return null;
}

async function clickVisibleVerificationButton(page: Page): Promise<boolean> {
  return page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    if (!modal) return false;
    const buttons = Array.from(modal.querySelectorAll("button, a")) as HTMLElement[];
    for (const button of buttons) {
      const text = (button.innerText ?? button.textContent ?? "").trim().toLowerCase();
      if (!text || button.offsetParent === null) continue;
      if (/verify|submit|continue/.test(text)) {
        button.click();
        return true;
      }
    }
    return false;
  }, ACTIVE_MODAL_SELECTOR).catch(() => false);
}

async function waitForLoadingStateToSettle(page: Page, timeout = 20_000): Promise<"navigated" | "validation" | "settled" | "still-loading"> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!page.url().includes("/customer-info")) return "navigated";
    const state = await inspectSubmitOverlay(page);
    if (state.validationMessages.length > 0) return "validation";
    if (state.loadingIndicators.length === 0) return "settled";
    await humanPause(300, 700);
  }
  return "still-loading";
}

const OTP_INPUT_SELECTORS = [
  "ngb-modal-window input[autocomplete='one-time-code']",
  ".modal input[autocomplete='one-time-code']",
  "[role='dialog'] input[autocomplete='one-time-code']",
  "ngb-modal-window input[id^='otp_']",
  ".modal input[id^='otp_']",
  "[role='dialog'] input[id^='otp_']",
  "ngb-modal-window input[type='tel']",
  ".modal input[type='tel']",
  "[role='dialog'] input[type='tel']"
];

async function hasVisibleOtpInput(page: Page): Promise<boolean> {
  for (const selector of OTP_INPUT_SELECTORS) {
    const visible = await page.locator(selector).first().isVisible({ timeout: 250 }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function fillVerificationCode(page: Page, code: string): Promise<boolean> {
  for (const selector of OTP_INPUT_SELECTORS) {
    const locator = page.locator(selector);
    const total = await locator.count().catch(() => 0);
    if (!total) continue;

    const visibleInputs: Locator[] = [];
    for (let index = 0; index < total; index += 1) {
      const input = locator.nth(index);
      if (await input.isVisible({ timeout: 250 }).catch(() => false)) visibleInputs.push(input);
    }
    if (!visibleInputs.length) continue;

    if (visibleInputs.length > 1) {
      const digits = code.slice(0, visibleInputs.length).split("");
      for (let index = 0; index < digits.length; index += 1) {
        await humanType(visibleInputs[index], digits[index]);
      }
      return true;
    }

    await humanType(visibleInputs[0], code);
    return true;
  }
  return false;
}

async function waitForVerificationModalToSettle(page: Page, timeout = 10_000): Promise<"closed" | "open"> {
  const deadline = Date.now() + timeout;
  const modalRoot = page.locator(".modal, ngb-modal-window, .swal2-container").first();
  while (Date.now() < deadline) {
    if (!page.url().includes("/customer-info")) return "closed";
    const modalVisible = await modalRoot.isVisible({ timeout: 300 }).catch(() => false);
    if (!modalVisible) return "closed";
    const overlay = await inspectSubmitOverlay(page);
    if (overlay.loadingIndicators.length > 0) {
      await humanPause(300, 650);
      continue;
    }
    await humanPause(250, 450);
  }
  return "open";
}

async function waitForVerificationSignal(page: Page, captured: CapturedFlightData, timeout = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (captured.validationMessage && /verif|code|otp|validate your email/i.test(captured.validationMessage)) return true;
    const hasOtpInput = await hasVisibleOtpInput(page);
    if (hasOtpInput) return true;
    const hasModalButton = await findFirstVisibleLocator([
      page.locator(".modal button:has-text('Verify')").first(),
      page.locator(".modal button:has-text('Submit')").first(),
      page.locator(".modal button:has-text('Continue')").first(),
      page.locator("ngb-modal-window button:has-text('Verify')").first(),
      page.locator("ngb-modal-window button:has-text('Submit')").first(),
      page.locator("ngb-modal-window button:has-text('Continue')").first(),
      page.locator("[role='dialog'] button:has-text('Verify')").first(),
      page.locator("[role='dialog'] button:has-text('Submit')").first(),
      page.locator("[role='dialog'] button:has-text('Continue')").first()
    ]);
    if (hasModalButton) return true;
    await humanPause(200, 450);
  }
  return false;
}

function isMeaningfulValidationMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/^[+-]?\s*₦[\d,.\s]+$/.test(normalized)) return false;
  if (/^[+-]?\s*\$[\d,.\s]+$/.test(normalized)) return false;
  if (/^[+-]?\s*[\d,.\s]+$/.test(normalized)) return false;
  return normalized.length > 2;
}

async function resolveNonVerificationModal(page: Page, visibleButtons: string[]): Promise<boolean> {
  const actionLabels = ["apply", "continue", "skip", "no thanks", "not now", "close"];
  for (const label of actionLabels) {
    const button = page.locator(`.modal button:has-text("${label}"), ngb-modal-window button:has-text("${label}"), .swal2-container button:has-text("${label}"), .modal a:has-text("${label}"), ngb-modal-window a:has-text("${label}")`).first();
    if (!(await button.count().catch(() => 0))) continue;
    await humanClick(button, { timeout: 8_000 }).catch(() => button.click({ timeout: 8_000 }));
    return true;
  }

  if (visibleButtons.some((label) => /apply|continue|skip|not now|close/i.test(label))) {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll(".modal button, .modal a, ngb-modal-window button, ngb-modal-window a, .swal2-container button")) as HTMLElement[];
      for (const button of buttons) {
        const text = (button.innerText ?? button.textContent ?? "").trim().toLowerCase();
        if (/apply|continue|skip|not now|close/.test(text) && button.offsetParent !== null) {
          button.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (clicked) return true;
  }

  const closeBtn = page.locator("button:has-text('×'), button.close, button.btn-close, .modal [aria-label='Close']").first();
  if (await closeBtn.count().catch(() => 0)) {
    await closeBtn.click({ timeout: 5_000 }).catch(() => {});
    await closeBtn.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    return true;
  }

  return false;
}

async function pollConfirmationEmail(
  inbox: Inbox,
  sinceIso: string,
  notify: (msg: string) => Promise<void>
): Promise<ConfirmationEmail | undefined> {
  console.log(`[api-book] Polling AgentMail for booking confirmation...`);
  await notify("📬 Waiting for your booking confirmation...");
  const msg = await agentmail.waitForMessage(inbox.id, {
    timeoutMs: 180_000,
    sinceIso,
    matcher: (m: AgentMailMessage) =>
      /wakanow/i.test(m.from) || /booking|itinerary|reservation|confirm/i.test(m.subject)
  });
  if (!msg) {
    console.log(`[api-book] No confirmation email received within timeout`);
    return undefined;
  }
  console.log(`[api-book] Confirmation email received: ${msg.subject}`);
  await notify("📬 Booking confirmation received.");
  return {
    from: msg.from,
    subject: msg.subject,
    receivedAt: msg.timestamp,
    preview: agentmail.messageBody(msg).slice(0, 500)
  };
}

async function resolveVerificationCode(
  request: ApiBookingRequest,
  customerEmail: string,
  passenger: Passenger,
  inbox: Inbox | undefined,
  notify: (msg: string) => Promise<void>
): Promise<{ code?: string; status: BookingVerificationStatus }> {
  if (inbox) {
    const recentCode = await findRecentVerificationCode(inbox);
    if (recentCode) {
      console.log(`[api-book] Reusing recent verification code from inbox ${inbox.email}`);
      await notify("⏳ Continuing your booking...");
      return { code: recentCode, status: "automated" };
    }

    console.log(`[api-book] Polling AgentMail for verification code...`);
    await notify("⏳ Continuing your booking...");
    const msg = await agentmail.waitForMessage(inbox.id, {
      timeoutMs: 90_000,
      matcher: (m) => /wakanow|verif|code|otp/i.test(`${m.from} ${m.subject}`) && agentmail.extractOtpCode(agentmail.messageBody(m)) !== undefined
    });
    const code = msg && agentmail.extractOtpCode(agentmail.messageBody(msg));
    if (code) return { code, status: "automated" };
    console.log(`[api-book] AgentMail poll timed out or no code in message`);
  }
  if (request.onVerificationCode) {
    return { code: await request.onVerificationCode(customerEmail), status: "manual_assist" };
  }
  return { code: undefined, status: "not_needed" };
}

async function findRecentVerificationCode(inbox: Inbox): Promise<string | undefined> {
  const lookbackMs = 15 * 60_000;
  const sinceIso = new Date(Date.now() - lookbackMs).toISOString();
  const messages = await agentmail.listMessages(inbox.id, { after: sinceIso, limit: 20 }).catch(() => []);
  if (messages.length > 0) {
    console.log(`[api-book] Recent inbox messages for ${inbox.email}: ${JSON.stringify(
      messages.map((message) => ({
        id: message.message_id,
        from: message.from,
        subject: message.subject,
        timestamp: message.timestamp,
        preview: message.preview?.slice(0, 120) ?? ""
      }))
    )}`);
  } else {
    console.log(`[api-book] No recent inbox messages found for ${inbox.email} since ${sinceIso}`);
    const allMessages = await agentmail.listMessages(inbox.id, { limit: 20 }).catch(() => []);
    if (allMessages.length > 0) {
      console.log(`[api-book] Unfiltered inbox messages for ${inbox.email}: ${JSON.stringify(
        allMessages.map((message) => ({
          id: message.message_id,
          from: message.from,
          subject: message.subject,
          timestamp: message.timestamp,
          preview: message.preview?.slice(0, 120) ?? ""
        }))
      )}`);
    } else {
      console.log(`[api-book] Inbox ${inbox.email} has no messages even without filters`);
    }
  }
  const candidates = messages
    .filter((message) => /wakanow|verif|code|otp/i.test(`${message.from} ${message.subject} ${message.preview ?? ""}`))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (candidates.length > 0) {
    console.log(`[api-book] Recent verification candidates for ${inbox.email}: ${JSON.stringify(
      candidates.map((message) => ({
        id: message.message_id,
        from: message.from,
        subject: message.subject,
        timestamp: message.timestamp,
        preview: message.preview?.slice(0, 120) ?? ""
      }))
    )}`);
  }

  for (const message of candidates) {
    const hydrated = await agentmail.getMessage(inbox.id, message.message_id).catch(() => message);
    const code = agentmail.extractOtpCode(agentmail.messageBody(hydrated));
    if (code) {
      console.log(`[api-book] Recent verification candidate ${message.message_id} from ${message.timestamp} code=${code}`);
      return code;
    }
  }

  if (messages.length === 0) {
    const allMessages = await agentmail.listMessages(inbox.id, { limit: 20 }).catch(() => []);
    const olderCandidates = allMessages
      .filter((message) => /wakanow|verif|code|otp/i.test(`${message.from} ${message.subject} ${message.preview ?? ""}`))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    for (const message of olderCandidates) {
      const hydrated = await agentmail.getMessage(inbox.id, message.message_id).catch(() => message);
      const code = agentmail.extractOtpCode(agentmail.messageBody(hydrated));
      if (code) {
        console.log(`[api-book] Reusing older verification candidate ${message.message_id} from ${message.timestamp} code=${code}`);
        return code;
      }
    }
  }

  return undefined;
}
