import { env } from "../../config.js";
import { getWallet, insertWallet, markWalletFunded, type WalletRecord } from "../../db.js";
import { encrypt, decrypt } from "./crypto.js";
import { fundTestnet, generateWallet } from "./stellar.js";

export type EnsuredWallet = {
  record: WalletRecord;
  created: boolean;
};

/**
 * Return the user's wallet, generating one on first call.
 * On testnet, funds new wallets via friendbot (failures are non-fatal).
 */
export async function ensureWallet(telegramId: number): Promise<EnsuredWallet> {
  const existing = getWallet(telegramId);
  if (existing) return { record: existing, created: false };

  const { publicKey, secretKey } = generateWallet();
  const encrypted = encrypt(secretKey);
  insertWallet(telegramId, publicKey, encrypted, env.STELLAR_NETWORK, false);

  if (env.STELLAR_NETWORK === "testnet") {
    try {
      await fundTestnet(publicKey);
      markWalletFunded(telegramId);
    } catch (err) {
      console.warn(`[wallet] Friendbot funding failed for ${telegramId}:`, err);
    }
  }

  const record = getWallet(telegramId)!;
  return { record, created: true };
}

export function revealSecret(record: WalletRecord): string {
  return decrypt(record.encryptedSecret);
}
