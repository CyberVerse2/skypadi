import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import type {
  ConversationDraft,
  ConversationExpectedField,
} from "../domain/conversation/conversation.service.js";

export type TripIntentExtraction = {
  kind?: "flight_search" | "general_chat";
  reply?: string;
  origin?: string;
  destination?: string;
  departureDate?: string;
  departureWindow?: string;
  returnDate?: string;
  adults?: number;
};

export type IntentExtractionInput = {
  text: string;
  now: Date;
  expectedField?: ConversationExpectedField;
  currentDraft: ConversationDraft;
};

export type IntentExtractor = {
  extractTripIntent(input: IntentExtractionInput): Promise<TripIntentExtraction>;
};

const tripIntentSchema = z.object({
  kind: z.enum(["flight_search", "general_chat"]),
  reply: z.string().trim().min(1).nullable(),
  origin: z.string().trim().min(1).nullable(),
  destination: z.string().trim().min(1).nullable(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  departureWindow: z.string().trim().min(1).nullable(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  adults: z.number().int().positive().nullable(),
});

type TripIntentObject = z.infer<typeof tripIntentSchema>;

type GenerateObjectForIntent = (input: {
  model: unknown;
  schema: typeof tripIntentSchema;
  prompt: string;
}) => Promise<{ object: TripIntentObject }>;

export type OpenAIIntentExtractorOptions = {
  apiKey: string;
  model: string;
  generateObject?: GenerateObjectForIntent;
};

export function createOpenAIIntentExtractor(options: OpenAIIntentExtractorOptions): IntentExtractor {
  const apiKey = options.apiKey.trim();
  const modelName = options.model.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for WhatsApp flight intent extraction");
  }

  if (!modelName) {
    throw new Error("OPENAI_INTENT_MODEL is required for WhatsApp flight intent extraction");
  }

  const openai = createOpenAI({ apiKey });
  const generate = options.generateObject ?? (generateObject as GenerateObjectForIntent);

  return {
    async extractTripIntent(input) {
      const result = await generate({
        model: openai(modelName),
        schema: tripIntentSchema,
        prompt: buildTripIntentPrompt(input),
      });

      return compactTripIntent(result.object);
    },
  };
}

function compactTripIntent(object: TripIntentObject): TripIntentExtraction {
  const extraction: TripIntentExtraction = {};

  extraction.kind = object.kind;
  if (object.reply) extraction.reply = object.reply;
  if (object.origin) extraction.origin = object.origin;
  if (object.destination) extraction.destination = object.destination;
  if (object.departureDate) extraction.departureDate = object.departureDate;
  if (object.departureWindow) extraction.departureWindow = object.departureWindow;
  if (object.returnDate) extraction.returnDate = object.returnDate;
  if (object.adults) extraction.adults = object.adults;

  return extraction;
}

function buildTripIntentPrompt(input: IntentExtractionInput): string {
  const currentDate = input.now.toISOString().slice(0, 10);
  return [
    "Extract flight-search intent from this WhatsApp message for Skypadi.",
    "Classify the message as flight_search only when the user is asking to search, compare, price, or book travel.",
    "Classify greetings, capability questions, payment questions, support questions, and casual messages as general_chat.",
    "For general_chat, reply with one short helpful Skypadi response and leave all travel fields null.",
    "For flight_search, set reply to null and return only travel fields explicitly stated or strongly implied by the message and conversation context.",
    "Use IATA airport codes for origin when the user names a departure city or airport.",
    "Use city names for destination when an IATA code is not explicit.",
    "Resolve relative dates against the current date.",
    "Never invent origin, destination, trip type, passenger count, or travel dates.",
    "",
    `Current date: ${currentDate}`,
    `Expected field: ${input.expectedField ?? "none"}`,
    `Current draft: ${JSON.stringify(input.currentDraft)}`,
    `Message: ${input.text}`,
  ].join("\n");
}
