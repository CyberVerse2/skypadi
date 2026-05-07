import { env } from "../../config";
import type { WakanowAccountCredentials } from "./wakanow.types";

export const wakanowConfig = {
  get baseUrl(): string {
    return env.WAKANOW_BASE_URL;
  },
  get locale(): string {
    return env.WAKANOW_LOCALE;
  },
  get currency(): string {
    return env.WAKANOW_CURRENCY;
  },
  get timezone(): string {
    return env.WAKANOW_TIMEZONE;
  },
  get maxResults(): number {
    return env.WAKANOW_MAX_RESULTS;
  },
  get cookieWarmupEnabled(): boolean {
    return env.WAKANOW_COOKIE_WARMUP !== "false";
  },
  get cookieWarmupTtlMs(): number {
    return env.WAKANOW_COOKIE_WARMUP_TTL_MS;
  },
  get cookieWarmupTimeoutMs(): number {
    return env.WAKANOW_COOKIE_WARMUP_TIMEOUT_MS;
  },
  get browserExecutablePath(): string | undefined {
    return env.WAKANOW_BROWSER_EXECUTABLE_PATH;
  },
  get browserHeadless(): boolean {
    return env.WAKANOW_BROWSER_HEADLESS !== "false";
  },
  get browserProfileDir(): string {
    return env.WAKANOW_BROWSER_PROFILE_DIR;
  },
  get browserIdleTtlMs(): number {
    return env.WAKANOW_BROWSER_IDLE_TTL_MS;
  },
  get passwordGrantAuth(): string | undefined {
    return env.WAKANOW_PASSWORD_GRANT_AUTH;
  },
  get bookingAuthSalt(): string | undefined {
    return env.WAKANOW_BOOKING_AUTH_SALT;
  },
  get proxyUrl(): string | undefined {
    return env.PROXY_URL;
  },
  get proxyUrls(): string[] {
    return parseWakanowProxyUrls(env.WAKANOW_PROXY_URLS ?? env.PROXY_URL);
  },
  get accounts(): WakanowAccountCredentials[] {
    return wakanowAccountPoolFromEnv();
  },
  get webOrigin(): string {
    return stripTrailingSlash(env.WAKANOW_BASE_URL);
  },
  get webReferer(): string {
    return `${stripTrailingSlash(env.WAKANOW_BASE_URL)}/`;
  },
  search: {
    apiBaseUrl: "https://flights.wakanow.com/api/flights",
    pollIntervalMs: 1_500,
    maxPolls: 6,
    fetchTimeoutMs: 15_000,
  },
  booking: {
    apiBaseUrl: "https://booking.wakanow.com/api/booking",
    fetchTimeoutMs: 30_000,
  },
  accountAuth: {
    tokenEndpoint: "https://wakanow-api-users-production-prod.azurewebsites.net/token",
    tokenRefreshSkewMs: 5 * 60_000,
  },
};

export function wakanowCommonHeaders(input: {
  currency?: string;
  contentType?: "json" | "form";
} = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json, text/plain, */*",
    "Origin": wakanowConfig.webOrigin,
    "Referer": wakanowConfig.webReferer,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };

  if (input.contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  if (input.contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }
  if (input.currency) {
    headers["x-currency"] = input.currency;
  }

  return headers;
}

export function wakanowAccountCredentialsFromConfig(): WakanowAccountCredentials | undefined {
  return wakanowConfig.accounts[0];
}

export function wakanowAccountPoolFromConfig(): WakanowAccountCredentials[] {
  return wakanowConfig.accounts;
}

function wakanowAccountPoolFromEnv(): WakanowAccountCredentials[] {
  const accounts = [
    accountFromPair(env.WAKANOW_ACCOUNT_EMAIL, env.WAKANOW_ACCOUNT_PASSWORD),
    accountFromPair(env.WAKANOW_ACCOUNT_1_EMAIL, env.WAKANOW_ACCOUNT_1_PASSWORD),
    accountFromPair(env.WAKANOW_ACCOUNT_2_EMAIL, env.WAKANOW_ACCOUNT_2_PASSWORD),
    accountFromPair(env.WAKANOW_ACCOUNT_3_EMAIL, env.WAKANOW_ACCOUNT_3_PASSWORD),
    accountFromPair(env.WAKANOW_ACCOUNT_4_EMAIL, env.WAKANOW_ACCOUNT_4_PASSWORD),
  ].filter((account): account is WakanowAccountCredentials => Boolean(account));

  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = account.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function accountFromPair(email: string | undefined, password: string | undefined): WakanowAccountCredentials | undefined {
  if (!email || !password) return undefined;
  return { email, password };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function parseWakanowProxyUrls(value: string | undefined): string[] {
  if (!value) return [];

  const urls = value
    .split(/[\n,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeProxyUrl);

  return Array.from(new Set(urls));
}

function normalizeProxyUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;

  const parts = value.split(":");
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }

  return `http://${value}`;
}
