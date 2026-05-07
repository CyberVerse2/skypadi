import { afterEach, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://skypadi_test:skypadi_test@localhost:5432/skypadi_test";
process.env.WALLET_ENCRYPTION_KEY ??= "test-wallet-encryption-key";
process.env.WAKANOW_COOKIE_WARMUP ??= "false";
process.env.WAKANOW_PROXY_URLS ??= "";
process.env.PROXY_URL ??= "";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
