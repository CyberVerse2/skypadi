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

export function createRuleBasedIntentExtractor(): IntentExtractor {
  return {
    async extractTripIntent(input) {
      const lowerText = input.text.toLowerCase();
      const extraction: TripIntentExtraction = {};

      if (lowerText.includes("abuja")) {
        extraction.destination = "Abuja";
      }

      if (lowerText.includes("tomorrow")) {
        assignDate(extraction, input.expectedField, toIsoDate(addDays(input.now, 1)));
      }

      if (lowerText.includes("next week")) {
        assignDate(extraction, input.expectedField, toIsoDate(addDays(input.now, 7)));
      }

      const isoDate = /\b\d{4}-\d{2}-\d{2}\b/.exec(input.text)?.[0];
      if (isoDate && isValidIsoDate(isoDate)) {
        assignDate(extraction, input.expectedField, isoDate);
      }

      if (lowerText.includes("morning")) {
        extraction.departureWindow = "morning";
      }

      if (input.expectedField === "passenger_count") {
        const adults = parsePassengerCount(input.text);
        if (adults) {
          extraction.adults = adults;
        }
      }

      return extraction;
    },
  };
}

function assignDate(
  extraction: TripIntentExtraction,
  expectedField: ConversationExpectedField | undefined,
  date: string
): void {
  if (expectedField === "return_date") {
    extraction.returnDate = date;
    return;
  }

  extraction.departureDate = date;
}

function parsePassengerCount(text: string): number | undefined {
  const trimmedText = text.trim();
  if (!/^\d+$/.test(trimmedText)) {
    return undefined;
  }

  const count = Number.parseInt(trimmedText, 10);
  return count > 0 ? count : undefined;
}

function isValidIsoDate(isoDate: string): boolean {
  const parsedDate = new Date(`${isoDate}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
