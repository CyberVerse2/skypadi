import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearWakanowAccountTokenCacheForTest,
  createWakanowAccountFetch,
  getWakanowAccountToken,
  WakanowAccountAuthError,
  type WakanowAccountAuthFetch,
} from "../../src/integrations/wakanow/account-auth";
import { env } from "../../src/config";

describe("Wakanow account auth", () => {
  beforeEach(() => {
    clearWakanowAccountTokenCacheForTest();
    env.WAKANOW_PASSWORD_GRANT_AUTH = "Basic test-password-grant-auth";
  });

  test("posts password grant credentials and returns token", async () => {
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

    expect(token).toBe("supplier-token");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      authorization: "Basic test-password-grant-auth",
    });
    expect(calls[0]?.body).toContain("grant_type=password");
    expect(calls[0]?.body).toContain("username=bookings%40bookings.skypadi.com");
    expect(calls[0]?.body).toContain("password=secret-password");
  });

  test.each([
    {
      name: "password grant auth is absent",
      run: () => {
        env.WAKANOW_PASSWORD_GRANT_AUTH = undefined;
        return getWakanowAccountToken({
          credentials: {
            email: "bookings@bookings.skypadi.com",
            password: "secret-password",
          },
          fetchImpl: async () => jsonResponse({ access_token: "supplier-token" }),
        });
      },
      message: "Wakanow password grant auth is not configured",
    },
    {
      name: "credentials are absent",
      run: () => getWakanowAccountToken({ credentials: null }),
      message: "Wakanow account credentials are not configured",
    },
  ])("fails closed when $name", async ({ run, message }) => {
    await expect(run()).rejects.toMatchObject({
      name: "WakanowAccountAuthError",
      message,
    } satisfies Partial<WakanowAccountAuthError>);
  });

  test("attaches bearer token and preserves existing cookies", async () => {
    const bookingCalls: Array<{ url: string; authorization?: string | null; cookie?: string | null }> = [];
    const fetchImpl: WakanowAccountAuthFetch = async (url, init = {}) => {
      if (url.includes("/token")) {
        return jsonResponse({
          access_token: "supplier-token",
          expires_in: 3600,
        });
      }

      const headers = new Headers(init.headers);
      bookingCalls.push({
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

    expect(bookingCalls).toEqual([
      {
        url: "https://booking.wakanow.com/api/booking/Booking/Validate",
        authorization: "Bearer supplier-token",
        cookie: "cultureInfo=en-ng; token=supplier-token",
      },
    ]);
  });

  test("does not choose accounts from an in-memory pool", async () => {
    const fetchImpl = vi.fn<WakanowAccountAuthFetch>(async (url) => {
      if (url.includes("/token")) {
        return jsonResponse({
          access_token: "unexpected-token",
          expires_in: 3600,
        });
      }

      return jsonResponse({ ok: true });
    });

    const authenticatedFetch = createWakanowAccountFetch(fetchImpl, {
      // Runtime guard for stale callers: account selection belongs in account-assignment.ts.
      accountPool: [
        { email: "amaka.nwosu@bookings.skypadi.com", password: "password-1" },
        { email: "tolu.adebayo@bookings.skypadi.com", password: "password-2" },
      ],
      now: () => 1_000,
    } as Parameters<typeof createWakanowAccountFetch>[1] & { accountPool: unknown });

    await expect(authenticatedFetch("https://booking.wakanow.com/api/booking/Booking/Validate"))
      .rejects
      .toMatchObject({
        name: "WakanowAccountAuthError",
        message: "Wakanow account credentials are not configured",
      } satisfies Partial<WakanowAccountAuthError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
