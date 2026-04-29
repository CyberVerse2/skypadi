import type { DbClient } from "../db/client.js";
import {
  type DisplayFlightOption,
  rankFlightOptionsForDisplay,
  type DisplayRankedFlightOptions,
} from "../domain/flight/flight-search.service.js";
import { findRankedOptionsForSearch } from "../domain/flight/flight.repository.js";
import type { WorkflowResult } from "./workflow-result.js";
import { makeOk } from "./workflow-result.js";

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
