import { afterEach, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://skypadi_test:skypadi_test@localhost:5432/skypadi_test";
process.env.WALLET_ENCRYPTION_KEY ??= "test-wallet-encryption-key";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
