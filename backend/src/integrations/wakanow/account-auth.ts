import {
  wakanowAccountCredentialsFromConfig,
  wakanowAccountPoolFromConfig,
  wakanowCommonHeaders,
  wakanowConfig,
} from "./wakanow.config";
import type {
  WakanowAccountAuthFetch,
  WakanowAccountAuthOptions,
  WakanowAccountCredentials,
  WakanowAccountTokenCache,
  WakanowAccountTokenResponse,
} from "./wakanow.types";

export type { WakanowAccountAuthFetch, WakanowAccountCredentials } from "./wakanow.types";

export class WakanowAccountAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WakanowAccountAuthError";
  }
}

const sharedTokens = new Map<string, WakanowAccountTokenCache>();

export function wakanowAccountCredentialsFromEnv(): WakanowAccountCredentials | undefined {
  return wakanowAccountCredentialsFromConfig();
}

export function wakanowAccountPoolFromEnv(): WakanowAccountCredentials[] {
  return wakanowAccountPoolFromConfig();
}

export async function getWakanowAccountToken(options: WakanowAccountAuthOptions = {}): Promise<string> {
  const credentials = options.credentials === undefined ? wakanowAccountCredentialsFromEnv() : options.credentials;
  if (!credentials) {
    throw new WakanowAccountAuthError("Wakanow account credentials are not configured");
  }

  const now = options.now ?? Date.now;
  const cacheKey = credentials.email.toLowerCase();
  const cachedToken = sharedTokens.get(cacheKey);
  if (cachedToken && cachedToken.expiresAt - wakanowConfig.accountAuth.tokenRefreshSkewMs > now()) {
    return cachedToken.accessToken;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const passwordGrantAuth = wakanowConfig.passwordGrantAuth;
  if (!passwordGrantAuth) {
    throw new WakanowAccountAuthError("Wakanow password grant auth is not configured");
  }

  const response = await fetchImpl(wakanowConfig.accountAuth.tokenEndpoint, {
    method: "POST",
    headers: {
      ...wakanowCommonHeaders({ contentType: "form" }),
      "Authorization": passwordGrantAuth,
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
  options: WakanowAccountAuthOptions = {},
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

function parseTokenResponse(text: string): WakanowAccountTokenResponse {
  try {
    return JSON.parse(text) as WakanowAccountTokenResponse;
  } catch {
    throw new WakanowAccountAuthError("Wakanow account login returned invalid JSON");
  }
}

function parseTokenExpiry(data: WakanowAccountTokenResponse, now: number): number {
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
