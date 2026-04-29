import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import type {
  ConversationDraft,
  ConversationExpectedField,
} from "../domain/conversation/conversation.service.js";

export type TripIntentExtraction = {
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
  origin: z.string().trim().min(1).optional(),
  destination: z.string().trim().min(1).optional(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  departureWindow: z.string().trim().min(1).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adults: z.number().int().positive().optional(),
});

type GenerateObjectForIntent = (input: {
  model: unknown;
  schema: typeof tripIntentSchema;
  prompt: string;
}) => Promise<{ object: TripIntentExtraction }>;

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

      return result.object;
    },
  };
}

function buildTripIntentPrompt(input: IntentExtractionInput): string {
  const currentDate = input.now.toISOString().slice(0, 10);
  return [
    "Extract flight-search intent from this WhatsApp message for Skypadi.",
    "Return only fields explicitly stated or strongly implied by the message and conversation context.",
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
