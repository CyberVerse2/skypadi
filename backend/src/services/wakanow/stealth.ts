import { promises as fs } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "patchright";
import { FingerprintGenerator } from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";

const fpGen = new FingerprintGenerator({
  browsers: [{ name: "chrome", minVersion: 128 }],
  devices: ["desktop"],
  operatingSystems: ["windows", "macos"],
  locales: ["en-NG", "en-US", "en"]
});
const fpInjector = new FingerprintInjector();

const WAKANOW_NG_COOKIES = [
  { name: "waaboraliases", value: "en-ng", domain: ".wakanow.com", path: "/" },
  { name: "cultureInfo", value: "en-ng", domain: ".wakanow.com", path: "/" },
  { name: "CountryCode", value: "NG", domain: ".wakanow.com", path: "/" },
  { name: "CurrencyCode", value: "NGN", domain: ".wakanow.com", path: "/" }
];

const LAGOS_GEO = { latitude: 6.5244, longitude: 3.3792 };
const SESSION_MAX_AGE_MS = 20 * 60_000; // CF clearance typically expires ~30m; refresh early

export type LaunchOpts = {
  headless?: boolean;
  proxyUrl?: string;
  extraArgs?: string[];
};

export async function launchStealthBrowser(opts: LaunchOpts = {}): Promise<Browser> {
  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: opts.headless ?? true,
    channel: "chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-http2", ...(opts.extraArgs ?? [])]
  };
  if (opts.proxyUrl) {
    const u = new URL(opts.proxyUrl);
    launchOpts.proxy = { server: `${u.protocol}//${u.hostname}:${u.port}`, username: u.username, password: u.password };
  }
  return chromium.launch(launchOpts);
}

export type ContextOpts = {
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number } | "lagos";
  sessionStatePath?: string;
  /** Block images, fonts, and known analytics/tracking domains to speed up page loads
   *  and reduce proxy bandwidth. Default true. */
  blockAssets?: boolean;
  /** Record all network traffic to this HAR file. For creating golden test fixtures. */
  recordHarPath?: string;
  /** Replay network from this HAR file instead of hitting live servers. Unmatched requests
   *  are aborted to surface "forgot to record X" gaps early. */
  replayHarPath?: string;
};

const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "hotjar.com",
  "doubleclick.net",
  "facebook.com",
  "facebook.net",
  "segment.com",
  "segment.io",
  "mixpanel.com",
  "fullstory.com",
  "clarity.ms"
];

export async function createStealthContext(browser: Browser, opts: ContextOpts = {}): Promise<BrowserContext> {
  const fp = fpGen.getFingerprint();
  const storageState = opts.sessionStatePath ? await loadSessionState(opts.sessionStatePath) : undefined;

  const geolocation = opts.geolocation === "lagos" ? LAGOS_GEO : opts.geolocation;

  // Do NOT set context-level `locale` — it collapses navigator.languages to a single
  // entry, a known headless tell. NG identity carried via cookies + Accept-Language.
  const context = await browser.newContext({
    timezoneId: opts.timezoneId ?? "Africa/Lagos",
    userAgent: fp.fingerprint.navigator.userAgent,
    viewport: { width: fp.fingerprint.screen.width, height: fp.fingerprint.screen.height },
    extraHTTPHeaders: { "Accept-Language": "en-NG,en-US;q=0.9,en;q=0.8" },
    ...(geolocation ? { geolocation, permissions: ["geolocation"] } : {}),
    ...(storageState ? { storageState } : {}),
    ...(opts.recordHarPath ? { recordHar: { path: opts.recordHarPath, content: "embed" } } : {})
  });
  await fpInjector.attachFingerprintToPlaywright(context as any, fp);
  await context.addCookies(WAKANOW_NG_COOKIES);

  if (opts.replayHarPath) {
    await context.routeFromHAR(opts.replayHarPath, { notFound: "abort" });
  }

  if (opts.blockAssets !== false) {
    await context.route("**/*", (route) => {
      const req = route.request();
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media") return route.abort();
      const url = req.url();
      if (BLOCKED_DOMAINS.some((d) => url.includes(d))) return route.abort();
      return route.continue();
    });
  }

  return context;
}

export async function saveSessionState(context: BrowserContext, filePath: string): Promise<void> {
  try {
    const state: any = await context.storageState();
    state._savedAt = Date.now();
    await fs.writeFile(filePath, JSON.stringify(state), "utf8");
  } catch (e: any) {
    console.log(`[stealth] session save failed: ${e.message}`);
  }
}

async function loadSessionState(filePath: string): Promise<any | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed?._savedAt ?? 0) > SESSION_MAX_AGE_MS) return undefined;
    return parsed;
  } catch { return undefined; }
}

export async function detectChallenge(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const body = document.body?.innerText?.toLowerCase() ?? "";
      if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return "cloudflare-turnstile";
      if (document.querySelector('iframe[src*="hcaptcha.com"]')) return "hcaptcha";
      if (document.querySelector('iframe[src*="recaptcha"]')) return "recaptcha";
      if (document.querySelector('[data-testid="px-captcha"], #px-captcha')) return "perimeterx";
      if (/attention required|cf-ray|cloudflare/.test(body) && /verify you are human|checking your browser/.test(body)) return "cloudflare-challenge";
      if (/access denied|request blocked/.test(body)) return "generic-waf";
      return null;
    });
  } catch { return null; }
}

export function randJitter(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export async function humanPause(minMs = 220, maxMs = 520): Promise<void> {
  await new Promise((r) => setTimeout(r, randJitter(minMs, maxMs)));
}

export async function humanType(locator: Locator, value: string): Promise<void> {
  try {
    await locator.click({ delay: randJitter(40, 110) });
    await humanPause(60, 180);
    await locator.pressSequentially(value, { delay: randJitter(45, 110) });
    await humanPause(80, 220);
  } catch {
    await locator.fill(value); // fallback for Angular forms that lose focus mid-type
  }
}

export async function humanClick(locator: Locator, opts: { timeout?: number } = {}): Promise<void> {
  const timeout = opts.timeout ?? 5_000;
  await humanPause(150, 360);
  await locator.hover({ timeout }).catch(() => undefined);
  await humanPause(90, 240);
  await locator.click({ timeout, delay: randJitter(40, 110) });
}
