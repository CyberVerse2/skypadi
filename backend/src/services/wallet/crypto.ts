import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

const KEY: Buffer = (() => {
  const raw = env.WALLET_ENCRYPTION_KEY;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`WALLET_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
})();

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
