import { env } from "../../config";

const TOKEN_ENDPOINT = "https://wakanow-api-users-production-prod.azurewebsites.net/token";
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

export type WakanowAccountCredentials = {
  email: string;
  password: string;
};

export type WakanowAccountAuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class WakanowAccountAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WakanowAccountAuthError";
  }
}

type TokenResponse = {
  access_token?: string;
  userName?: string;
  ".expires"?: string;
  expires_in?: number;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

type AuthOptions = {
  credentials?: WakanowAccountCredentials | null;
  fetchImpl?: WakanowAccountAuthFetch;
  now?: () => number;
};

const sharedTokens = new Map<string, TokenCache>();

export function wakanowAccountCredentialsFromEnv(): WakanowAccountCredentials | undefined {
  return wakanowAccountPoolFromEnv()[0];
}

export function wakanowAccountPoolFromEnv(): WakanowAccountCredentials[] {
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
  return {
    email,
    password,
  };
}

export async function getWakanowAccountToken(options: AuthOptions = {}): Promise<string> {
  const credentials = options.credentials === undefined ? wakanowAccountCredentialsFromEnv() : options.credentials;
  if (!credentials) {
    throw new WakanowAccountAuthError("Wakanow account credentials are not configured");
  }

  const now = options.now ?? Date.now;
  const cacheKey = credentials.email.toLowerCase();
  const cachedToken = sharedTokens.get(cacheKey);
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS > now()) {
    return cachedToken.accessToken;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const passwordGrantAuth = env.WAKANOW_PASSWORD_GRANT_AUTH;
  if (!passwordGrantAuth) {
    throw new WakanowAccountAuthError("Wakanow password grant auth is not configured");
  }

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": passwordGrantAuth,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://www.wakanow.com",
      "Referer": "https://www.wakanow.com/",
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: credentials.email,
      password: credentials.password,
    }),
  });

  const text = await response.text();
  const data = parseTokenResponse(text);
  if (!response.ok || !data.access_token) {
    throw new WakanowAccountAuthError(`Wakanow account login failed with ${response.status}`);
  }

  const token = {
    accessToken: data.access_token,
    expiresAt: parseTokenExpiry(data, now()),
  };
  sharedTokens.set(cacheKey, token);
  return token.accessToken;
}

export function createWakanowAccountFetch(
  baseFetch: WakanowAccountAuthFetch,
  options: AuthOptions = {},
): WakanowAccountAuthFetch {
  const sessionCredentials = options.credentials ?? null;

  return async (url, init = {}) => {
    const token = await getWakanowAccountToken({
      ...options,
      credentials: sessionCredentials,
      fetchImpl: options.fetchImpl ?? baseFetch,
    });
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Cookie", appendCookie(headers.get("Cookie"), `token=${token}`));
    return baseFetch(url, { ...init, headers });
  };
}

export function clearWakanowAccountTokenCacheForTest(): void {
  sharedTokens.clear();
}

function parseTokenResponse(text: string): TokenResponse {
  try {
    return JSON.parse(text) as TokenResponse;
  } catch {
    throw new WakanowAccountAuthError("Wakanow account login returned invalid JSON");
  }
}

function parseTokenExpiry(data: TokenResponse, now: number): number {
  if (data[".expires"]) {
    const parsed = Date.parse(data[".expires"]);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (data.expires_in && Number.isFinite(data.expires_in)) {
    return now + data.expires_in * 1000;
  }
  return now + 30 * 60_000;
}

function appendCookie(existing: string | null, cookie: string): string {
  if (!existing) return cookie;
  if (existing.split(";").some((value) => value.trim().startsWith("token="))) return existing;
  return `${existing}; ${cookie}`;
}
