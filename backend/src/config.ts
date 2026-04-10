import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
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
  WAKANOW_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  WAKANOW_MAX_RESULTS: z.coerce.number().int().positive().default(10),
  PROXY_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);
