import type { DbClient } from "../db/client";
import type { FlightListIntent, UiIntent } from "../channels/whatsapp/whatsapp.types";
import { flightOptionReplyId } from "../channels/whatsapp/whatsapp.reply-ids";
import { env } from "../config";
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
  arrival_at: Date | string;
  amount: string | number;
  stops: number;
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
        maxResults: env.WAKANOW_MAX_RESULTS,
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
  const options = recommendedOptions(ranked);

  return {
    type: "flight_list",
    body: comparisonBody(options, ranked.bestValue),
    buttonText: "Choose flight",
    rows: options.map((option, index) => ({
      id: flightOptionReplyId(option.flight.id),
      title: truncate(`${index + 1} ${option.label}: ${option.flight.airline}`, 24),
      description: truncate(
        `${option.flight.departureTime}-${option.flight.arrivalTime} - NGN ${option.flight.price.toLocaleString("en-NG")}`,
        72
      ),
    })),
  };
}

type RecommendedFlightOption = {
  label: "Cheapest" | "Best" | "Fastest" | "Evening";
  bodyLabel: "Cheapest" | "Best Value" | "Fastest" | "Evening";
  flight: DisplayFlightOption;
};

function recommendedOptions(ranked: DisplayRankedFlightOptions): RecommendedFlightOption[] {
  const selected: RecommendedFlightOption[] = [];
  const usedFlightIds = new Set<string>();
  const categories: Array<Omit<RecommendedFlightOption, "flight"> & { flight: DisplayFlightOption }> = [
    { label: "Cheapest", bodyLabel: "Cheapest", flight: ranked.cheapest },
    { label: "Best", bodyLabel: "Best Value", flight: ranked.bestValue },
    { label: "Fastest", bodyLabel: "Fastest", flight: ranked.fastest },
    { label: "Evening", bodyLabel: "Evening", flight: ranked.evening },
  ];

  for (const category of categories) {
    const fallback = findReplacementFlight({
      category,
      options: ranked.options,
      usedFlightIds,
    });
    if (!fallback) continue;
    selected.push({ label: category.label, bodyLabel: category.bodyLabel, flight: fallback });
    usedFlightIds.add(fallback.id);
  }

  return selected;
}

function findReplacementFlight(input: {
  category: RecommendedFlightOption;
  options: DisplayFlightOption[];
  usedFlightIds: Set<string>;
}): DisplayFlightOption | undefined {
  if (!input.usedFlightIds.has(input.category.flight.id)) {
    return input.category.flight;
  }

  const candidates = candidatesForCategory(input.category, input.options)
    .filter((option) => !input.usedFlightIds.has(option.id));
  return candidates[0];
}

function candidatesForCategory(category: RecommendedFlightOption, options: DisplayFlightOption[]): DisplayFlightOption[] {
  if (category.label === "Best") {
    return options.filter((option) => isInDepartureWindow(option, 12, 18)).sort(compareByPriceThenDeparture);
  }
  if (category.label === "Fastest") {
    return [...options].sort(compareByDurationThenPrice);
  }
  if (category.label === "Evening") {
    return options.filter((option) => isInDepartureWindow(option, 18, 24)).sort(compareByPriceThenDeparture);
  }
  return [...options].sort(compareByPriceThenDeparture);
}

function comparisonBody(options: RecommendedFlightOption[], bestValue: DisplayFlightOption): string {
  const recommendation = options.find((option) => option.flight.id === bestValue.id) ?? options[0]!;
  const lines = options.map((option, index) => {
    return `${index + 1}. ${option.bodyLabel} — ${option.flight.airline}\n${option.flight.departureTime} → ${option.flight.arrivalTime} — ₦${option.flight.price.toLocaleString("en-NG")}\n${detailLine(option)}`;
  });
  const cheapest = options.find((option) => option.bodyLabel === "Cheapest") ?? options[0]!;
  const premium = recommendation.flight.price - cheapest.flight.price;
  const reason = recommendationReason(recommendation, premium);

  return [
    `I found ${options.length} good options:`,
    ...lines,
    `My recommendation: ${recommendation.flight.airline}. ${reason}`,
  ].join("\n\n");
}

function detailLine(option: RecommendedFlightOption): string {
  if (option.label === "Best") return "Cheapest afternoon flight.";
  if (option.label === "Fastest") return `${option.flight.durationMinutes} min flight time.`;
  if (option.label === "Evening") return "Cheapest evening flight.";
  return "Lowest fare.";
}

function recommendationReason(recommendation: RecommendedFlightOption, premium: number): string {
  if (recommendation.label !== "Best") {
    return "It is the strongest available pick from the options I found.";
  }
  if (premium > 0) {
    return `It is ₦${premium.toLocaleString("en-NG")} more than the cheapest, but it gives you an afternoon departure.`;
  }
  return "It is the cheapest afternoon option, so it keeps the trip calm without adding cost.";
}

function compareByPriceThenDeparture(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return left.price - right.price || parseDepartureMinutes(left.departureTime) - parseDepartureMinutes(right.departureTime);
}

function compareByDurationThenPrice(left: DisplayFlightOption, right: DisplayFlightOption): number {
  return left.durationMinutes - right.durationMinutes || compareByPriceThenDeparture(left, right);
}

function isInDepartureWindow(option: DisplayFlightOption, startHour: number, endHour: number): boolean {
  const minutes = parseDepartureMinutes(option.departureTime);
  return minutes >= startHour * 60 && minutes < endHour * 60;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function toDisplayFlightOption(row: StoredFlightOptionRow, displayTimeZone = "Africa/Lagos"): DisplayFlightOption {
  return {
    id: row.id,
    airline: row.airline_name ?? "Unknown airline",
    departureTime: formatDepartureTime(row.departure_at, displayTimeZone),
    arrivalTime: formatDepartureTime(row.arrival_at, displayTimeZone),
    durationMinutes: durationMinutes(row.departure_at, row.arrival_at),
    price: Number(row.amount),
    stops: row.stops,
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

function durationMinutes(departureAt: Date | string, arrivalAt: Date | string): number {
  const departure = departureAt instanceof Date ? departureAt : new Date(departureAt);
  const arrival = arrivalAt instanceof Date ? arrivalAt : new Date(arrivalAt);
  return Math.max(0, Math.round((arrival.getTime() - departure.getTime()) / 60_000));
}

function parseDepartureMinutes(departureTime: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(departureTime);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}
