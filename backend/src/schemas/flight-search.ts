import { z } from "zod";
import { env } from "../config.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const flightSearchRequestSchema = z
  .object({
    origin: z.string().trim().min(3).max(32),
    destination: z.string().trim().min(3).max(32),
    departureDate: dateSchema,
    returnDate: dateSchema.optional(),
    headless: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
    maxResults: z.number().int().positive().max(20).default(env.WAKANOW_MAX_RESULTS)
  })
  .superRefine((value, ctx) => {
    if (value.returnDate && value.returnDate < value.departureDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDate"],
        message: "returnDate must be on or after departureDate"
      });
    }
  });

export type FlightSearchRequest = z.infer<typeof flightSearchRequestSchema>;

export type FlightSearchResult = {
  airline: string | null;
  priceText: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  duration: string | null;
  stops: string | null;
  deeplink: string;
  rawText: string;
  date?: string;
  flightId?: string;
  searchKey?: string;
};

export type FlightSearchResponse = {
  provider: "wakanow";
  searchedAt: string;
  request: FlightSearchRequest;
  resultCount: number;
  results: FlightSearchResult[];
};
