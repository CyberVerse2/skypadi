import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  PGSSLMODE: z.enum(["disable", "prefer", "require"]).default("prefer"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  WAKANOW_BASE_URL: z.string().url().default("https://www.wakanow.com"),
  WAKANOW_LOCALE: z.string().default("en-NG"),
  WAKANOW_CURRENCY: z.string().default("NGN"),
  WAKANOW_TIMEZONE: z.string().default("Africa/Lagos"),
  WAKANOW_HEADLESS: z
    .string()
    .transform((value) => value !== "false")
    .default("true"),
  WAKANOW_BROWSER_CHANNEL: z.enum(["chrome", "msedge"]).optional(),
  WAKANOW_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  WAKANOW_MAX_RESULTS: z.coerce.number().int().positive().default(10),
  PROXY_URL: z.string().optional(),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  WALLET_ENCRYPTION_KEY: z
    .string()
    .min(1, "WALLET_ENCRYPTION_KEY is required (32-byte key as hex or base64)"),
  AGENTMAIL_API_KEY: z.string().optional(),
  AGENTMAIL_INBOX_ID: z.string().optional()
});

export const env = envSchema.parse(process.env);

export type StellarNetwork = "testnet" | "mainnet";
