import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  PGSSLMODE: z.enum(["disable", "prefer", "require"]).default("prefer"),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_PASSENGER_DETAILS_FLOW_ID: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_INTENT_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  WAKANOW_BASE_URL: z.string().url().default("https://www.wakanow.com"),
  WAKANOW_LOCALE: z.string().default("en-NG"),
  WAKANOW_CURRENCY: z.string().default("NGN"),
  WAKANOW_TIMEZONE: z.string().default("Africa/Lagos"),
  WAKANOW_MAX_RESULTS: z.coerce.number().int().positive().default(50),
  WAKANOW_ACCOUNT_EMAIL: z.string().email().optional(),
  WAKANOW_ACCOUNT_PASSWORD: z.string().min(1).optional(),
  WAKANOW_ACCOUNT_1_EMAIL: z.string().email().optional(),
  WAKANOW_ACCOUNT_1_PASSWORD: z.string().min(1).optional(),
  WAKANOW_ACCOUNT_2_EMAIL: z.string().email().optional(),
  WAKANOW_ACCOUNT_2_PASSWORD: z.string().min(1).optional(),
  WAKANOW_ACCOUNT_3_EMAIL: z.string().email().optional(),
  WAKANOW_ACCOUNT_3_PASSWORD: z.string().min(1).optional(),
  WAKANOW_ACCOUNT_4_EMAIL: z.string().email().optional(),
  WAKANOW_ACCOUNT_4_PASSWORD: z.string().min(1).optional(),
  PROXY_URL: z.string().optional(),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  WALLET_ENCRYPTION_KEY: z
    .string()
    .min(1, "WALLET_ENCRYPTION_KEY is required (32-byte key as hex or base64)"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  RESEND_INBOUND_DOMAIN: z.string().optional()
});

export const env = envSchema.parse(process.env);

export type StellarNetwork = "testnet" | "mainnet";
