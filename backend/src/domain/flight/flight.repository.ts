import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "../../db/client.js";
import type { FlightSearchResponse, FlightSearchResult } from "../../schemas/flight-search.js";

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
      ${request.returnDate},
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
        ${dateTimeFromSearchResult(request.departureDate, result.departureTime)},
        ${dateTimeFromSearchResult(request.departureDate, result.arrivalTime ?? result.departureTime)},
        ${parseStops(result)},
        ${parsePriceAmount(result.priceText)},
        'NGN',
        ${JSON.stringify({ baggageIncluded: true })}::jsonb,
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

function dateTimeFromSearchResult(date: string, time: string | null): Date {
  if (!time) return new Date(`${date}T00:00:00.000+01:00`);
  return new Date(`${date}T${time}:00.000+01:00`);
}
