import assert from "node:assert/strict";

import { beforeEach, test } from "vitest";

import {
  clearWakanowAccountTokenCacheForTest,
  createWakanowAccountFetch,
  getWakanowAccountToken,
  WakanowAccountAuthError,
  type WakanowAccountAuthFetch,
} from "../../src/integrations/wakanow/account-auth";

beforeEach(() => {
  clearWakanowAccountTokenCacheForTest();
});

test("Wakanow account auth posts password grant credentials and returns token", async () => {
  const calls: Array<{ url: string; method?: string; body?: string; authorization?: string }> = [];
  const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      body: String(init.body),
      authorization: new Headers(init.headers).get("authorization") ?? undefined,
    });
    return jsonResponse({
      access_token: "supplier-token",
      userName: "bookings@bookings.skypadi.com",
      expires_in: 3600,
    });
  };

  const token = await getWakanowAccountToken({
    credentials: {
      email: "bookings@bookings.skypadi.com",
      password: "secret-password",
    },
    fetchImpl,
    now: () => 1_000,
  });

  assert.equal(token, "supplier-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.authorization?.startsWith("Basic "), true);
  assert.match(calls[0]?.body ?? "", /grant_type=password/);
  assert.match(calls[0]?.body ?? "", /username=bookings%40bookings\.skypadi\.com/);
  assert.match(calls[0]?.body ?? "", /password=secret-password/);
});

test("Wakanow account auth fails closed when credentials are absent", async () => {
  await assert.rejects(
    () => getWakanowAccountToken({ credentials: null }),
    (error) =>
      error instanceof WakanowAccountAuthError
      && error.message === "Wakanow account credentials are not configured",
  );
});

test("Wakanow account fetch attaches bearer token and preserves existing cookies", async () => {
  const calls: Array<{ url: string; authorization?: string | null; cookie?: string | null }> = [];
  const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
    if (url.includes("/token")) {
      return jsonResponse({
        access_token: "supplier-token",
        expires_in: 3600,
      });
    }

    const headers = new Headers(init.headers);
    calls.push({
      url,
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    });
    return jsonResponse({ ok: true });
  };

  const authenticatedFetch = createWakanowAccountFetch(fetchImpl, {
    credentials: {
      email: "bookings@bookings.skypadi.com",
      password: "secret-password",
    },
    now: () => 1_000,
  });

  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate", {
    method: "POST",
    headers: { Cookie: "cultureInfo=en-ng" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.authorization, "Bearer supplier-token");
  assert.equal(calls[0]?.cookie, "cultureInfo=en-ng; token=supplier-token");
});

test("Wakanow account fetch pins one supplier account for a booking session", async () => {
  const loginBodies: string[] = [];
  const requestTokens: Array<string | null> = [];
  const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
    if (url.includes("/token")) {
      const body = String(init.body);
      loginBodies.push(body);
      const username = new URLSearchParams(body).get("username") ?? "missing";
      return jsonResponse({
        access_token: `token-for-${username}`,
        expires_in: 3600,
      });
    }

    requestTokens.push(new Headers(init.headers).get("authorization"));
    return jsonResponse({ ok: true });
  };

  const authenticatedFetch = createWakanowAccountFetch(fetchImpl, {
    accountPool: [
      { email: "amaka.nwosu@bookings.skypadi.com", password: "password-1" },
      { email: "tolu.adebayo@bookings.skypadi.com", password: "password-2" },
      { email: "chinedu.okoro@bookings.skypadi.com", password: "password-3" },
      { email: "zainab.bello@bookings.skypadi.com", password: "password-4" },
    ],
    now: () => 1_000,
  });

  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");
  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");
  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");
  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");
  await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");

  assert.deepEqual(
    loginBodies.map((body) => new URLSearchParams(body).get("username")),
    ["amaka.nwosu@bookings.skypadi.com"],
  );
  assert.deepEqual(requestTokens, [
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
  ]);
});

test("Wakanow account fetch round robins across booking sessions", async () => {
  const loginBodies: string[] = [];
  const requestTokens: Array<string | null> = [];
  const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
    if (url.includes("/token")) {
      const body = String(init.body);
      loginBodies.push(body);
      const username = new URLSearchParams(body).get("username") ?? "missing";
      return jsonResponse({
        access_token: `token-for-${username}`,
        expires_in: 3600,
      });
    }

    requestTokens.push(new Headers(init.headers).get("authorization"));
    return jsonResponse({ ok: true });
  };
  const accountPool = [
    { email: "amaka.nwosu@bookings.skypadi.com", password: "password-1" },
    { email: "tolu.adebayo@bookings.skypadi.com", password: "password-2" },
    { email: "chinedu.okoro@bookings.skypadi.com", password: "password-3" },
    { email: "zainab.bello@bookings.skypadi.com", password: "password-4" },
  ];

  for (let index = 0; index < 5; index += 1) {
    const authenticatedFetch = createWakanowAccountFetch(fetchImpl, {
      accountPool,
      now: () => 1_000,
    });
    await authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate");
  }

  assert.deepEqual(
    loginBodies.map((body) => new URLSearchParams(body).get("username")),
    [
      "amaka.nwosu@bookings.skypadi.com",
      "tolu.adebayo@bookings.skypadi.com",
      "chinedu.okoro@bookings.skypadi.com",
      "zainab.bello@bookings.skypadi.com",
    ],
  );
  assert.deepEqual(requestTokens, [
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
    "Bearer token-for-tolu.adebayo@bookings.skypadi.com",
    "Bearer token-for-chinedu.okoro@bookings.skypadi.com",
    "Bearer token-for-zainab.bello@bookings.skypadi.com",
    "Bearer token-for-amaka.nwosu@bookings.skypadi.com",
  ]);
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
