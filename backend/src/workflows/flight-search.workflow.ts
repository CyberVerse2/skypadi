import type { DbClient } from "../db/client";
import type { CtaButtonIntent, FlightListIntent, ReplyButtonsIntent, UiIntent } from "../channels/whatsapp/whatsapp.types";
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
  duration_minutes: number | null;
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
        departureWindow?: string;
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

      return rankedFlightOptionsToIntent(ranked.value, request.search.departureWindow);
    },
  };
}

export function rankedFlightOptionsToIntent(
  ranked: DisplayRankedFlightOptions,
  departureWindow = "anytime"
): FlightListIntent | ReplyButtonsIntent | CtaButtonIntent {
  const requestedWindow = normalizedDepartureWindow(departureWindow);
  if (requestedWindow) {
    const options = focusedWindowOptions(ranked, requestedWindow);
    return focusedWindowOptionsToButtonIntent(options, requestedWindow, ranked.cheapest);
  }

  return recommendedOptionsToListIntent(recommendedOptions(ranked), ranked.bestValue);
}

export const rankedFlightOptionsToListIntent = rankedFlightOptionsToIntent;

function recommendedOptionsToListIntent(
  options: RecommendedFlightOption[],
  bestValue: DisplayFlightOption
): FlightListIntent {
  return {
    type: "flight_list",
    body: comparisonBody(options, bestValue),
    buttonText: "Choose flight",
    rows: options.map((option, index) => flightOptionRow(option, index)),
  };
}

function focusedWindowOptionsToButtonIntent(
  options: RecommendedFlightOption[],
  requestedWindow: DepartureWindow,
  cheapest: DisplayFlightOption
): CtaButtonIntent | ReplyButtonsIntent {
  const selected = options[0]!;
  if (cheapest.id === selected.flight.id) {
    return {
      type: "cta_button",
      body: focusedWindowBody(options, requestedWindow, cheapest),
      button: {
        id: flightOptionReplyId(selected.flight.id),
        title: "Book this",
      },
    };
  }

  const buttons: ReplyButtonsIntent["buttons"] = [
    {
      id: flightOptionReplyId(selected.flight.id),
      title: "Book this",
    },
  ];

  buttons.push({
    id: flightOptionReplyId(cheapest.id),
    title: "Cheapest overall",
  });

  return {
    type: "reply_buttons",
    body: focusedWindowBody(options, requestedWindow, cheapest),
    buttons,
  };
}

function flightOptionRow(option: RecommendedFlightOption, index: number): FlightListIntent["rows"][number] {
  return {
    id: flightOptionReplyId(option.flight.id),
    title: truncate(`${index + 1} ${option.label}: ${option.flight.airline}`, 24),
    description: truncate(
      `${option.flight.departureTime}-${option.flight.arrivalTime} - NGN ${option.flight.price.toLocaleString("en-NG")} - ${directnessSummary(option.flight)}`,
      72
    ),
  };
}

type RecommendedFlightOption = {
  label: "Morning" | "Afternoon" | "Evening" | "Fastest";
  bodyLabel: "Morning" | "Afternoon" | "Best Morning" | "Best Evening" | "Fastest" | "Evening";
  flight: DisplayFlightOption;
};

function recommendedOptions(ranked: DisplayRankedFlightOptions): RecommendedFlightOption[] {
  const selected: RecommendedFlightOption[] = [];
  const usedFlightIds = new Set<string>();
  const categories: Array<Omit<RecommendedFlightOption, "flight"> & { flight: DisplayFlightOption }> = [
    { label: "Morning", bodyLabel: "Morning", flight: ranked.morning },
    { label: "Afternoon", bodyLabel: "Afternoon", flight: ranked.afternoon },
    { label: "Evening", bodyLabel: "Evening", flight: ranked.evening },
    { label: "Fastest", bodyLabel: "Fastest", flight: ranked.fastest },
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

function focusedWindowOptions(
  ranked: DisplayRankedFlightOptions,
  departureWindow: DepartureWindow
): RecommendedFlightOption[] {
  const flight = cheapestInDepartureWindow(ranked.options, departureWindow) ?? ranked.cheapest;
  return [
    {
      label: "Morning",
      bodyLabel: bestWindowLabel(departureWindow),
      flight,
    },
  ];
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
  if (category.label === "Morning") {
    return options.filter((option) => isInDepartureWindow(option, 5, 12)).sort(compareByPriceThenDeparture);
  }
  if (category.label === "Afternoon") {
    return options.filter((option) => isInDepartureWindow(option, 12, 17)).sort(compareByPriceThenDeparture);
  }
  if (category.label === "Fastest") {
    return [...options].sort(compareByDurationThenPrice);
  }
  if (category.label === "Evening") {
    return options.filter((option) => isInDepartureWindow(option, 18, 24)).sort(compareByPriceThenDeparture);
  }
  return [...options].sort(compareByPriceThenDeparture);
}

type DepartureWindow = "morning" | "afternoon" | "evening";

function normalizedDepartureWindow(value: string | undefined): DepartureWindow | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "morning" || normalized === "afternoon" || normalized === "evening") {
    return normalized;
  }
  return undefined;
}

function cheapestInDepartureWindow(
  options: DisplayFlightOption[],
  departureWindow: DepartureWindow
): DisplayFlightOption | undefined {
  const [startHour, endHour] = departureWindowHours(departureWindow);
  return options.filter((option) => isInDepartureWindow(option, startHour, endHour)).sort(compareByPriceThenDeparture)[0];
}

function departureWindowHours(departureWindow: DepartureWindow): [number, number] {
  if (departureWindow === "morning") return [5, 12];
  if (departureWindow === "afternoon") return [12, 17];
  return [17, 24];
}

function bestWindowLabel(departureWindow: DepartureWindow): RecommendedFlightOption["bodyLabel"] {
  if (departureWindow === "morning") return "Best Morning";
  if (departureWindow === "afternoon") return "Afternoon";
  return "Best Evening";
}

function comparisonBody(options: RecommendedFlightOption[], bestValue: DisplayFlightOption): string {
  const recommendation = options.find((option) => option.flight.id === bestValue.id) ?? options[0]!;
  const cheapest = [...options].sort((left, right) => compareByPriceThenDeparture(left.flight, right.flight))[0]!;
  const lines = options.map((option, index) => {
    return `${index + 1}. ${option.bodyLabel} — ${option.flight.airline}\n${option.flight.departureTime} → ${option.flight.arrivalTime} — ₦${option.flight.price.toLocaleString("en-NG")}\n${detailLine(option, cheapest.flight)}`;
  });
  const premium = recommendation.flight.price - cheapest.flight.price;
  const reason = recommendationReason(recommendation, premium);

  return [
    `I found ${options.length} good options:`,
    ...lines,
    `My recommendation: ${recommendation.flight.airline}. ${reason}`,
  ].join("\n\n");
}

function focusedWindowBody(
  options: RecommendedFlightOption[],
  requestedWindow: DepartureWindow,
  cheapest: DisplayFlightOption
): string {
  const selected = options[0]!;
  const savings = selected.flight.price - cheapest.price;
  const lines = [
    `${selected.bodyLabel} — ${selected.flight.airline}`,
    `${selected.flight.departureTime} → ${selected.flight.arrivalTime} — ₦${selected.flight.price.toLocaleString("en-NG")}`,
    `${directnessSummary(selected.flight)}. This is the cheapest ${requestedWindow} option I found.`,
  ];

  if (savings > 0 && cheapest.id !== selected.flight.id) {
    lines.push(
      `You could save ₦${savings.toLocaleString("en-NG")} if you travel at ${timeWindowName(cheapest)} instead: ${cheapest.airline}, ${cheapest.departureTime} → ${cheapest.arrivalTime}.`
    );
  } else {
    lines.push("This is also the cheapest option I found.");
  }

  return lines.join("\n\n");
}

function detailLine(option: RecommendedFlightOption, cheapest: DisplayFlightOption): string {
  const premium = option.flight.price - cheapest.price;
  const priceBand = premium > 0 ? `₦${premium.toLocaleString("en-NG")} more than cheapest.` : "Lowest fare.";
  if (option.label === "Morning") return `${directnessSummary(option.flight)}. Cheapest morning flight. ${priceBand}`;
  if (option.label === "Afternoon") return `${directnessSummary(option.flight)}. Cheapest afternoon flight. ${priceBand}`;
  if (option.label === "Fastest") return `${directnessSummary(option.flight)}. ${option.flight.durationMinutes} min flight time. ${priceBand}`;
  if (option.label === "Evening") return `${directnessSummary(option.flight)}. Cheapest evening flight. ${priceBand}`;
  return `${directnessSummary(option.flight)}. ${priceBand}`;
}

function recommendationReason(recommendation: RecommendedFlightOption, premium: number): string {
  if (recommendation.label === "Afternoon") {
    if (premium > 0) {
      return `It is only ₦${premium.toLocaleString("en-NG")} more than the cheapest, and it avoids the early morning start.`;
    }
    return "It has the best timing tradeoff and is also the lowest fare I found.";
  }
  if (recommendation.label === "Morning" && isSensibleMorning(recommendation.flight)) {
    return "It is the cheapest option and already a good morning time, so I would not pay extra for a later flight.";
  }
  if (recommendation.label === "Fastest") {
    return "It is worth considering because it saves meaningful flight time without a big fare jump.";
  }
  return "It is the strongest price and timing tradeoff from the options I found.";
}

function timeWindowName(option: DisplayFlightOption): string {
  const minutes = parseDepartureMinutes(option.departureTime);
  if (minutes >= 5 * 60 && minutes < 12 * 60) return "morning";
  if (minutes >= 12 * 60 && minutes < 17 * 60) return "afternoon";
  if (minutes >= 17 * 60) return "evening";
  return "that time";
}

function directnessSummary(option: DisplayFlightOption): string {
  if (option.stops === 0) return "Direct";
  if (option.stops === 1) return "1 stop";
  return `${option.stops} stops`;
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

function isSensibleMorning(option: DisplayFlightOption): boolean {
  const minutes = parseDepartureMinutes(option.departureTime);
  return minutes >= 10 * 60 && minutes < 12 * 60;
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
    durationMinutes: row.duration_minutes ?? durationMinutes(row.departure_at, row.arrival_at),
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
