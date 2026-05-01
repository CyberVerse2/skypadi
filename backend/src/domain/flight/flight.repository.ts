import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "../../db/client";
import type { FlightSearchResponse, FlightSearchResult } from "../../schemas/flight-search";

export async function findRankedOptionsForSearch(db: DbClient, flightSearchId: string) {
  return db.execute(sql`
    select *
    from skypadi_whatsapp.flight_options
    where flight_search_id = ${flightSearchId}
    order by amount asc, departure_at asc
  `);
}

export async function createStoredFlightSearchFromWakanow(input: {
  db: DbClient;
  userId: string;
  conversationId: string;
  response: FlightSearchResponse;
  now?: Date;
}): Promise<{ flightSearchId: string; optionIds: string[] }> {
  const now = input.now ?? new Date();
  const flightSearchId = randomUUID();
  const optionIds = input.response.results.map(() => randomUUID());
  const request = input.response.request;

  await input.db.execute(sql`
    insert into skypadi_whatsapp.flight_searches (
      id,
      user_id,
      conversation_id,
      origin,
      destination,
      departure_date,
      return_date,
      adults,
      currency,
      raw_request,
      created_at,
      updated_at
    )
    values (
      ${flightSearchId},
      ${input.userId},
      ${input.conversationId},
      ${request.origin},
      ${request.destination},
      ${request.departureDate},
      ${request.returnDate ?? null},
      1,
      'NGN',
      ${JSON.stringify(request)}::jsonb,
      ${now},
      ${now}
    )
  `);

  for (const [index, result] of input.response.results.entries()) {
    await input.db.execute(sql`
      insert into skypadi_whatsapp.flight_options (
        id,
        flight_search_id,
        supplier,
        supplier_option_id,
        airline_name,
        origin,
        destination,
        departure_at,
        arrival_at,
        duration_minutes,
        stops,
        amount,
        currency,
        fare_rules,
        supplier_payload,
        created_at,
        updated_at
      )
      values (
        ${optionIds[index]},
        ${flightSearchId},
        'wakanow',
        ${result.flightId},
        ${result.airline},
        ${request.origin},
        ${request.destination},
        ${departureDateTimeFromSearchResult(request.departureDate, result.departureTime)},
        ${arrivalDateTimeFromSearchResult(request.departureDate, result.departureTime, result.arrivalTime, result.duration)},
        ${parseDurationMinutes(result.duration)},
        ${parseStops(result)},
        ${parsePriceAmount(result.priceText)},
        'NGN',
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(result)}::jsonb,
        ${now},
        ${now}
      )
    `);
  }

  return { flightSearchId, optionIds };
}

function parsePriceAmount(priceText: string | null): number {
  const amount = Number.parseInt(priceText?.replace(/[^0-9]/g, "") ?? "", 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Wakanow result is missing a valid price");
  }
  return amount;
}

function parseStops(result: FlightSearchResult): number {
  if (!result.stops || result.stops === "non-stop") return 0;
  return Number.parseInt(result.stops, 10) || 0;
}

function departureDateTimeFromSearchResult(date: string, time: string | null): Date {
  if (!time) return new Date(`${date}T00:00:00.000+01:00`);
  return new Date(`${date}T${time}:00.000+01:00`);
}

function arrivalDateTimeFromSearchResult(
  date: string,
  departureTime: string | null,
  arrivalTime: string | null,
  duration: string | null
): Date {
  const departureAt = departureDateTimeFromSearchResult(date, departureTime);
  const durationMinutes = parseDurationMinutes(duration);
  if (durationMinutes !== null) {
    return new Date(departureAt.getTime() + durationMinutes * 60_000);
  }

  const arrivalAt = departureDateTimeFromSearchResult(date, arrivalTime ?? departureTime);
  return arrivalAt < departureAt ? new Date(arrivalAt.getTime() + 24 * 60 * 60_000) : arrivalAt;
}

function parseDurationMinutes(duration: string | null): number | null {
  if (!duration) return null;
  const hours = /(\d+)\s*h/.exec(duration)?.[1];
  const minutes = /(\d+)\s*m/.exec(duration)?.[1];
  const total = (hours ? Number.parseInt(hours, 10) * 60 : 0) + (minutes ? Number.parseInt(minutes, 10) : 0);
  return total > 0 ? total : null;
}
