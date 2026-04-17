import { Keypair } from "@stellar/stellar-sdk";
import { env } from "../../config.js";

export type GeneratedWallet = {
  publicKey: string;
  secretKey: string;
};

export function generateWallet(): GeneratedWallet {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secretKey: kp.secret() };
}

export async function fundTestnet(publicKey: string): Promise<void> {
  if (env.STELLAR_NETWORK !== "testnet") return;
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Friendbot funding failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
