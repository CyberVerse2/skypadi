import assert from "node:assert/strict";

import { beforeEach, test } from "vitest";

import {
  clearWakanowAccountTokenCacheForTest,
  createWakanowAccountFetch,
  getWakanowAccountToken,
  WakanowAccountAuthError,
  type WakanowAccountAuthFetch,
} from "../../src/integrations/wakanow/account-auth";
import { env } from "../../src/config";

beforeEach(() => {
  clearWakanowAccountTokenCacheForTest();
  env.WAKANOW_PASSWORD_GRANT_AUTH = "Basic test-password-grant-auth";
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
  assert.equal(calls[0]?.authorization, "Basic test-password-grant-auth");
  assert.match(calls[0]?.body ?? "", /grant_type=password/);
  assert.match(calls[0]?.body ?? "", /username=bookings%40bookings\.skypadi\.com/);
  assert.match(calls[0]?.body ?? "", /password=secret-password/);
});

test("Wakanow account auth fails closed when password grant auth is absent", async () => {
  env.WAKANOW_PASSWORD_GRANT_AUTH = undefined;

  await assert.rejects(
    () => getWakanowAccountToken({
      credentials: {
        email: "bookings@bookings.skypadi.com",
        password: "secret-password",
      },
      fetchImpl: async () => jsonResponse({ access_token: "supplier-token" }),
    }),
    (error) =>
      error instanceof WakanowAccountAuthError
      && error.message === "Wakanow password grant auth is not configured",
  );
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

test("Wakanow account fetch does not choose accounts from an in-memory pool", async () => {
  const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
    if (url.includes("/token")) {
      return jsonResponse({
        access_token: "unexpected-token",
        expires_in: 3600,
      });
    }

    return jsonResponse({ ok: true });
  };

  const authenticatedFetch = createWakanowAccountFetch(fetchImpl, {
    // Runtime guard for stale callers: account selection belongs in account-assignment.ts.
    accountPool: [
      { email: "amaka.nwosu@bookings.skypadi.com", password: "password-1" },
      { email: "tolu.adebayo@bookings.skypadi.com", password: "password-2" },
    ],
    now: () => 1_000,
  } as Parameters<typeof createWakanowAccountFetch>[1] & { accountPool: unknown });

  await assert.rejects(
    () => authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate"),
    (error) =>
      error instanceof WakanowAccountAuthError
      && error.message === "Wakanow account credentials are not configured",
  );
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
