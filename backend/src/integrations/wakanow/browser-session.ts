import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from "playwright";
import { wakanowConfig } from "./wakanow.config";
import type { WakanowApiSearchResponse } from "./wakanow.types";

type CachedCookieHeader = {
  value: string;
  expiresAt: number;
};

type BrowserProxy = {
  server: string;
  username?: string;
  password?: string;
};

type LiveBrowserSession = {
  context: BrowserContext;
  userDataDir: string;
  warmedAt: number;
  idleTimer?: NodeJS.Timeout;
};

const cookieCache = new Map<string, CachedCookieHeader>();
const profileLocks = new Map<string, Promise<void>>();
const liveSessions = new Map<string, LiveBrowserSession>();

export async function getWakanowBrowserCookieHeader(proxyUrl: string | undefined): Promise<string | undefined> {
  if (!wakanowConfig.cookieWarmupEnabled) return undefined;

  const cacheKey = proxyUrl ?? "direct";
  const cached = cookieCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const cookieHeader = await warmWakanowCookies(proxyUrl);
  if (!cookieHeader) return undefined;

  cookieCache.set(cacheKey, {
    value: cookieHeader,
    expiresAt: Date.now() + wakanowConfig.cookieWarmupTtlMs,
  });
  return cookieHeader;
}

export async function createWakanowSearchWithBrowser(input: {
  proxyUrl: string | undefined;
  searchUrl: string;
  searchBody: Record<string, unknown>;
}): Promise<{ status: number; text: string; cookieHeader?: string; searchData?: WakanowApiSearchResponse }> {
  const profileKey = browserProfileKey(input.proxyUrl);
  return withBrowserProfileLock(profileKey, async () => {
    const session = await getLiveBrowserSession(profileKey, input.proxyUrl);
    const page = await session.context.newPage();

    try {
      const response = await runSearchRoute(page, input.searchBody);
      const cookies = await session.context.cookies([wakanowConfig.webOrigin, wakanowConfig.search.apiBaseUrl]);
      return {
        ...response,
        cookieHeader: cookiesToHeader(cookies),
      };
    } finally {
      await page.close().catch(() => undefined);
      scheduleIdleClose(profileKey, session);
    }
  });
}

export async function selectWakanowFlightWithBrowser(input: {
  proxyUrl: string | undefined;
  selectBody: Record<string, unknown>;
}): Promise<{ status: number; text: string; cookieHeader?: string }> {
  const profileKey = browserProfileKey(input.proxyUrl);
  return withBrowserProfileLock(profileKey, async () => {
    const session = await getLiveBrowserSession(profileKey, input.proxyUrl);
    const page = await session.context.newPage();

    try {
      const response = await runSameOriginApiSelect(page, input.selectBody);
      const cookies = await session.context.cookies([wakanowConfig.webOrigin, wakanowConfig.search.apiBaseUrl]);
      return {
        ...response,
        cookieHeader: cookiesToHeader(cookies),
      };
    } finally {
      await page.close().catch(() => undefined);
      scheduleIdleClose(profileKey, session);
    }
  });
}

export async function validateWakanowBookingWithBrowser(input: {
  proxyUrl: string | undefined;
  validationBody: Record<string, unknown>;
}): Promise<{ status: number; text: string; cookieHeader?: string }> {
  return requestWakanowBookingWithBrowser({
    proxyUrl: input.proxyUrl,
    path: "/api/booking/Booking/Validate",
    method: "POST",
    body: input.validationBody,
  });
}

export async function requestWakanowBookingWithBrowser(input: {
  proxyUrl: string | undefined;
  path: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; text: string; cookieHeader?: string }> {
  const profileKey = browserProfileKey(input.proxyUrl);
  return withBrowserProfileLock(profileKey, async () => {
    const session = await getLiveBrowserSession(profileKey, input.proxyUrl);
    const page = await session.context.newPage();

    try {
      const response = await runSameOriginBookingRequest(page, {
        path: input.path,
        method: input.method,
        headers: input.headers,
        body: input.body,
      });
      const cookies = await session.context.cookies([
        wakanowConfig.webOrigin,
        wakanowConfig.search.apiBaseUrl,
        wakanowConfig.booking.apiBaseUrl,
      ]);
      return {
        ...response,
        cookieHeader: cookiesToHeader(cookies),
      };
    } finally {
      await page.close().catch(() => undefined);
      scheduleIdleClose(profileKey, session);
    }
  });
}

async function runSameOriginBookingRequest(
  page: Page,
  request: {
    path: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
  }
): Promise<{ status: number; text: string }> {
  const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
  await page.goto(`${wakanowConfig.booking.apiBaseUrl}${path.replace(/^\/api\/booking/, "")}`, {
    waitUntil: "commit",
    timeout: wakanowConfig.cookieWarmupTimeoutMs,
  }).catch(() => undefined);

  await page.waitForTimeout(1_000);

  return page.evaluate(
    async ({ request, path }) => {
      const response = await fetch(path, {
        method: request.method,
        redirect: "manual",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-NG",
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(request.headers ?? {}),
        },
        credentials: "include",
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      return { status: response.status, text: await response.text() };
    },
    { request, path }
  );
}

async function warmWakanowCookies(proxyUrl: string | undefined): Promise<string | undefined> {
  const browser = await launchWakanowBrowser(proxyUrl);

  try {
    const context = await newWakanowContext(browser);
    const page = await context.newPage();
    await visitWakanow(page);

    const cookies = await context.cookies([wakanowConfig.webOrigin, wakanowConfig.search.apiBaseUrl]);
    await context.close();
    return cookiesToHeader(cookies);
  } finally {
    await browser.close();
  }
}

function launchWakanowBrowser(proxyUrl: string | undefined) {
  return chromium.launch({
    headless: wakanowConfig.browserHeadless,
    ...(wakanowConfig.browserExecutablePath ? { executablePath: wakanowConfig.browserExecutablePath } : {}),
    ...(proxyUrl ? { proxy: proxyFromUrl(proxyUrl) } : {}),
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  });
}

function newWakanowContext(browser: Browser) {
  return browser.newContext({
    locale: wakanowConfig.locale,
    timezoneId: wakanowConfig.timezone,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
}

function launchPersistentWakanowContext(input: { proxyUrl: string | undefined; userDataDir: string }): Promise<BrowserContext> {
  return chromium.launchPersistentContext(input.userDataDir, {
    headless: wakanowConfig.browserHeadless,
    ...(wakanowConfig.browserExecutablePath ? { executablePath: wakanowConfig.browserExecutablePath } : {}),
    ...(input.proxyUrl ? { proxy: proxyFromUrl(input.proxyUrl) } : {}),
    locale: wakanowConfig.locale,
    timezoneId: wakanowConfig.timezone,
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  });
}

async function getLiveBrowserSession(profileKey: string, proxyUrl: string | undefined): Promise<LiveBrowserSession> {
  const existing = liveSessions.get(profileKey);
  if (existing) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
    }
    return existing;
  }

  const userDataDir = browserProfileDir(profileKey);
  await mkdir(userDataDir, { recursive: true });
  const context = await launchPersistentWakanowContext({ proxyUrl, userDataDir });
  const session = { context, userDataDir, warmedAt: 0 };
  liveSessions.set(profileKey, session);
  return session;
}

function scheduleIdleClose(profileKey: string, session: LiveBrowserSession) {
  if (session.idleTimer) clearTimeout(session.idleTimer);

  session.idleTimer = setTimeout(() => {
    if (liveSessions.get(profileKey) !== session) return;
    liveSessions.delete(profileKey);
    session.context.close().catch(() => undefined);
  }, wakanowConfig.browserIdleTtlMs);

  session.idleTimer.unref?.();
}

async function runSearchRoute(
  page: Page,
  searchBody: Record<string, unknown>
): Promise<{ status: number; text: string; searchData?: WakanowApiSearchResponse }> {
  const apiResult = await runSameOriginApiSearch(page, searchBody).catch(() => undefined);
  if (apiResult && isValidSearchKey(apiResult.text)) {
    return apiResult;
  }

  await visitWakanow(page);

  let createSearchResponse: { status: number; text: string } | undefined;
  let searchData: WakanowApiSearchResponse | undefined;

  page.on("response", async (response) => {
    const url = response.url();
    if (url.endsWith("/api/flights/Search")) {
      const text = await response.text().catch(() => "");
      if (text) createSearchResponse = { status: response.status(), text };
    }

    if (/\/api\/flights\/SearchV2\/[^/]+\/[^/]+$/.test(url)) {
      const text = await response.text().catch(() => "");
      if (text.startsWith("{")) {
        searchData = JSON.parse(text) as WakanowApiSearchResponse;
      }
    }
  });

  await page.goto(searchRouteUrl(searchBody), {
    waitUntil: "commit",
    timeout: wakanowConfig.cookieWarmupTimeoutMs,
  });

  const startedAt = Date.now();
  const timeoutMs = Math.min(Math.max(wakanowConfig.cookieWarmupTimeoutMs, 25_000), 45_000);
  while ((!createSearchResponse || !searchData?.SearchFlightResults?.length) && Date.now() - startedAt < timeoutMs) {
    if (createSearchResponse && isValidSearchKey(createSearchResponse.text) && Date.now() - startedAt > 5_000) {
      break;
    }
    await page.waitForTimeout(1_000);
  }

  if (createSearchResponse && searchData?.SearchFlightResults?.length) {
    return { ...createSearchResponse, searchData };
  }

  return {
    status: createSearchResponse?.status ?? 0,
    text: createSearchResponse?.text ?? "",
  };
}

async function runSameOriginApiSearch(
  page: Page,
  searchBody: Record<string, unknown>
): Promise<{ status: number; text: string; searchData?: WakanowApiSearchResponse }> {
  await page.goto(`${wakanowConfig.search.apiBaseUrl}/Search`, {
    waitUntil: "commit",
    timeout: wakanowConfig.cookieWarmupTimeoutMs,
  }).catch(() => undefined);

  await page.waitForTimeout(1_000);

  const result = await page.evaluate(
    async ({ searchBody, currency, maxPolls, pollIntervalMs }) => {
      const searchResponse = await fetch("/api/flights/Search", {
        method: "POST",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(searchBody),
      });

      const text = await searchResponse.text();
      const requestKey = text.replace(/"/g, "").trim();
      let searchData: unknown;

      if (requestKey && !requestKey.includes("Message") && !requestKey.includes("<")) {
        for (let attempt = 0; attempt < maxPolls; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          const pollResponse = await fetch(`/api/flights/SearchV2/${requestKey}/${currency}`, {
            headers: { "Accept": "application/json, text/plain, */*" },
            credentials: "include",
          });
          const pollText = await pollResponse.text();
          if (!pollText.startsWith("{")) continue;

          const parsed = JSON.parse(pollText) as { SearchFlightResults?: unknown[] };
          if (parsed.SearchFlightResults?.length) {
            searchData = parsed;
            break;
          }
        }
      }

      return { status: searchResponse.status, text, searchData };
    },
    {
      searchBody,
      currency: wakanowConfig.currency,
      maxPolls: Math.max(wakanowConfig.search.maxPolls, 20),
      pollIntervalMs: wakanowConfig.search.pollIntervalMs,
    }
  );

  return {
    status: result.status,
    text: result.text,
    searchData: result.searchData as WakanowApiSearchResponse | undefined,
  };
}

async function runSameOriginApiSelect(
  page: Page,
  selectBody: Record<string, unknown>
): Promise<{ status: number; text: string }> {
  await page.goto(`${wakanowConfig.search.apiBaseUrl}/Select`, {
    waitUntil: "commit",
    timeout: wakanowConfig.cookieWarmupTimeoutMs,
  }).catch(() => undefined);

  await page.waitForTimeout(1_000);

  return page.evaluate(
    async ({ selectBody, currency }) => {
      const response = await fetch("/api/flights/Select/", {
        method: "POST",
        redirect: "manual",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-NG",
          "Content-Type": "application/json",
          "x-currency": currency,
        },
        credentials: "include",
        body: JSON.stringify(selectBody),
      });

      return { status: response.status, text: await response.text() };
    },
    {
      selectBody,
      currency: wakanowConfig.currency,
    }
  );
}

function isValidSearchKey(text: string): boolean {
  const value = text.replace(/"/g, "").trim();
  return Boolean(value && !value.includes("Message") && !value.includes("<"));
}

function searchRouteUrl(searchBody: Record<string, unknown>): string {
  const view = parseFlightRequestView(searchBody);
  const itineraries = Array.isArray(view.Itineraries) ? view.Itineraries : [];
  const firstItinerary = { ...(itineraries[0] ?? {}) } as Record<string, unknown>;
  const secondItinerary = itineraries[1] as Record<string, unknown> | undefined;

  if (secondItinerary?.DepartureDate && !firstItinerary.ReturnDate) {
    firstItinerary.ReturnDate = secondItinerary.DepartureDate;
  }

  const routeModel = {
    ...view,
    Itineraries: [firstItinerary],
    FlightRequestView: "",
  };
  const params = new URLSearchParams();

  Object.entries(routeModel).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, key === "Itineraries" ? JSON.stringify(value) : String(value));
  });

  return `${wakanowConfig.webOrigin}/${wakanowConfig.locale.toLowerCase()}/flight/search?${params.toString()}`;
}

function parseFlightRequestView(searchBody: Record<string, unknown>): Record<string, unknown> {
  if (typeof searchBody.FlightRequestView === "string" && searchBody.FlightRequestView) {
    return JSON.parse(searchBody.FlightRequestView) as Record<string, unknown>;
  }
  return searchBody;
}

function browserProfileKey(proxyUrl: string | undefined): string {
  if (!proxyUrl) return "direct";
  return createHash("sha256").update(proxyUrl).digest("hex").slice(0, 16);
}

function browserProfileDir(profileKey: string): string {
  return join(wakanowConfig.browserProfileDir, profileKey);
}

async function withBrowserProfileLock<T>(profileKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = profileLocks.get(profileKey) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.catch(() => undefined).then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );

  profileLocks.set(profileKey, current);
  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (profileLocks.get(profileKey) === current) {
      profileLocks.delete(profileKey);
    }
  }
}

async function visitWakanow(page: Page) {
  await page.goto(wakanowConfig.webReferer, {
    waitUntil: "commit",
    timeout: wakanowConfig.cookieWarmupTimeoutMs,
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(3_000);
}

function proxyFromUrl(proxyUrl: string): BrowserProxy {
  const url = new URL(proxyUrl);
  return {
    server: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

function cookiesToHeader(cookies: Cookie[]): string | undefined {
  const pairs = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  if (pairs.length === 0) return undefined;
  return Array.from(new Set(pairs)).join("; ");
}
