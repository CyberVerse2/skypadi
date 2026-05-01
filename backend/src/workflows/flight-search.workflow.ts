import type { DbClient } from "../db/client";
import type { FlightListIntent, UiIntent } from "../channels/whatsapp/whatsapp.types";
import { flightOptionReplyId } from "../channels/whatsapp/whatsapp.reply-ids";
import type { FlightSearchResponse } from "../schemas/flight-search";
import { rankFlightOptionsForDisplay } from "../domain/flight/flight-search.service";
import type { DisplayFlightOption, DisplayRankedFlightOptions } from "../domain/flight/flight.types";
import { createStoredFlightSearchFromWakanow, findRankedOptionsForSearch } from "../domain/flight/flight.repository";
import type { WorkflowResult } from "./workflow-result";
import { makeOk } from "./workflow-result";

type StoredFlightOptionRow = {
  id: string;
  airline_name: string | null;
  departure_at: Date | string;
  amount: string | number;
  stops: number;
  fare_rules?: unknown;
};

export type FlightSearchWorkflowDependencies = {
  db: DbClient;
  displayTimeZone?: string;
};

export type FlightSearchProvider = {
  search(input: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    maxResults?: number;
  }): Promise<FlightSearchResponse>;
};

export async function presentStoredFlightOptions(
  flightSearchId: string,
  dependencies?: FlightSearchWorkflowDependencies
): Promise<WorkflowResult<DisplayRankedFlightOptions>> {
  if (!dependencies?.db) {
    return { kind: "temporary_failure", reason: "flight search database dependency is required" };
  }

  const result = await findRankedOptionsForSearch(dependencies.db, flightSearchId);
  const rows = result.rows as StoredFlightOptionRow[];

  if (rows.length === 0) {
    return { kind: "permanent_failure", reason: "no flight options found for search" };
  }

  return makeOk(rankFlightOptionsForDisplay(rows.map((row) => toDisplayFlightOption(row, dependencies.displayTimeZone))));
}

export function createFlightSearchPresentationHandler(input: {
  db: DbClient;
  provider: FlightSearchProvider;
  displayTimeZone?: string;
}) {
  return {
    async searchAndPresent(request: {
      userId: string;
      conversationId: string;
      search: {
        origin: string;
        destination: string;
        departureDate: string;
        returnDate?: string;
      };
    }): Promise<UiIntent> {
      const response = await input.provider.search({
        origin: request.search.origin,
        destination: request.search.destination,
        departureDate: request.search.departureDate,
        returnDate: request.search.returnDate,
        maxResults: 10,
      });
      const stored = await createStoredFlightSearchFromWakanow({
        db: input.db,
        userId: request.userId,
        conversationId: request.conversationId,
        response,
      });
      const ranked = await presentStoredFlightOptions(stored.flightSearchId, {
        db: input.db,
        displayTimeZone: input.displayTimeZone,
      });

      if (ranked.kind !== "ok") {
        return { type: "text", body: "I could not prepare flight options yet. Please try again." };
      }

      return rankedFlightOptionsToListIntent(ranked.value);
    },
  };
}

export function rankedFlightOptionsToListIntent(ranked: DisplayRankedFlightOptions): FlightListIntent {
  const options = topDistinctAirlineOptions(ranked.options, 3);

  return {
    type: "flight_list",
    body: comparisonBody(options, ranked.bestValue),
    buttonText: "Choose flight",
    rows: options.map((option) => ({
      id: flightOptionReplyId(option.id),
      title: option.airline.slice(0, 24),
      description: `${option.departureTime} - NGN ${option.price.toLocaleString("en-NG")}`.slice(0, 72),
    })),
  };
}

function topDistinctAirlineOptions(options: DisplayFlightOption[], limit: number): DisplayFlightOption[] {
  const selected = new Map<string, DisplayFlightOption>();
  for (const option of [...options].sort((left, right) => left.price - right.price || left.departureTime.localeCompare(right.departureTime))) {
    const key = option.airline.trim().toLowerCase();
    if (!selected.has(key)) selected.set(key, option);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
}

function comparisonBody(options: DisplayFlightOption[], bestValue: DisplayFlightOption): string {
  const recommendation = options.find((option) => option.id === bestValue.id) ?? options[0]!;
  const lines = options.map((option, index) => {
    const label = index === 0 ? "Cheapest" : option.id === recommendation.id ? "Best Value" : "Next Cheapest";
    const baggage = option.baggageIncluded ? "Baggage included." : "Check baggage before paying.";
    return `${index + 1}. ${label} — ${option.airline}\n${option.departureTime} — ₦${option.price.toLocaleString("en-NG")}\n${baggage}`;
  });
  const cheapest = options[0]!;
  const premium = recommendation.price - cheapest.price;
  const reason =
    premium > 0
      ? `It is ₦${premium.toLocaleString("en-NG")} more than the cheapest, but it should be less rushed and not stressful overall.`
      : "It is the cheapest solid option and keeps the trip simple.";

  return [
    `I found ${options.length} good options:`,
    ...lines,
    `My recommendation: ${recommendation.airline}. ${reason}`,
  ].join("\n\n");
}

function toDisplayFlightOption(row: StoredFlightOptionRow, displayTimeZone = "Africa/Lagos"): DisplayFlightOption {
  return {
    id: row.id,
    airline: row.airline_name ?? "Unknown airline",
    departureTime: formatDepartureTime(row.departure_at, displayTimeZone),
    price: Number(row.amount),
    stops: row.stops,
    baggageIncluded: hasIncludedBaggage(row.fare_rules),
  };
}

function formatDepartureTime(departureAt: Date | string, timeZone: string): string {
  const date = departureAt instanceof Date ? departureAt : new Date(departureAt);
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!hour || !minute) {
    throw new Error(`Could not format departure time for timezone: ${timeZone}`);
  }

  return `${hour}:${minute}`;
}

function hasIncludedBaggage(fareRules: unknown): boolean {
  return Boolean(
    fareRules &&
      typeof fareRules === "object" &&
      "baggageIncluded" in fareRules &&
      (fareRules as { baggageIncluded?: unknown }).baggageIncluded === true
  );
}
