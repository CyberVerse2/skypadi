import { env } from "../../config.js";
import { getWallet, insertWallet, markWalletFunded, type WalletRecord } from "../../db.js";
import { encrypt } from "./crypto.js";
import { fundTestnet, generateWallet } from "./stellar.js";

export type EnsuredWallet = {
  record: WalletRecord;
  created: boolean;
};

export function ensureWallet(telegramId: number): EnsuredWallet {
  const existing = getWallet(telegramId);
  if (existing) return { record: existing, created: false };

  const { publicKey, secretKey } = generateWallet();
  const encrypted = encrypt(secretKey);
  insertWallet(telegramId, publicKey, encrypted, env.STELLAR_NETWORK, false);

  if (env.STELLAR_NETWORK === "testnet") {
    void fundTestnet(publicKey)
      .then(() => markWalletFunded(telegramId))
      .catch((err) => console.warn(`[wallet] Friendbot funding failed for ${telegramId}:`, err));
  }

  const record: WalletRecord = {
    telegramId,
    publicKey,
    encryptedSecret: encrypted,
    network: env.STELLAR_NETWORK,
    funded: false,
    createdAt: new Date().toISOString()
  };
  return { record, created: true };
}
