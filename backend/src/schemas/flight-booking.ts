import { z } from "zod";
import { env } from "../config.js";

const titleEnum = z.enum(["Mr", "Ms", "Mrs", "Miss", "Sir", "Dr"]);
const genderEnum = z.enum(["Male", "Female"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const passengerSchema = z.object({
  title: titleEnum,
  firstName: z.string().trim().min(2).max(50),
  lastName: z.string().trim().min(2).max(50),
  middleName: z.string().trim().max(50).optional(),
  dateOfBirth: dateSchema,
  nationality: z.string().trim().default("Nigerian"),
  gender: genderEnum,
  phone: z.string().trim().min(7).max(20),
  email: z.string().email()
});

export const flightBookingRequestSchema = z.object({
  deeplink: z.string().url(),
  flightIndex: z.number().int().min(0).default(0),
  passengers: z.array(passengerSchema).min(1).max(1),
  headless: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional()
});

export type Passenger = z.infer<typeof passengerSchema>;
export type FlightBookingRequest = z.infer<typeof flightBookingRequestSchema>;

export type FlightBookingResponse = {
  provider: "wakanow";
  bookedAt: string;
  request: FlightBookingRequest;
  currentStep: string;
  currentUrl: string;
  pageContent: string;
};
