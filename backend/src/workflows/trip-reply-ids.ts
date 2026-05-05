import { airportByCode } from "../domain/flight/airport-catalog";

const ORIGIN_PREFIX = "origin:";
const DESTINATION_PREFIX = "destination:";
const DATE_PREFIX = "date:";
const DEPARTURE_WINDOW_PREFIX = "departure_window:";
const PASSENGERS_PREFIX = "passengers:";
const TRIP_TYPE_PREFIX = "trip_type:";
const NEW_TRIP_PREFIX = "new_trip:";

export type TripReply =
  | { kind: "origin"; value: string }
  | { kind: "destination"; value: string }
  | { kind: "date"; value: string }
  | { kind: "departure_window"; value: "morning" | "afternoon" | "evening" | "anytime" }
  | { kind: "passengers"; value: number | "more" }
  | { kind: "trip_type"; value: "one_way" | "return" }
  | { kind: "new_trip"; value: "start" | "yes" | "no" };

export function departureWindowReplyId(value: Extract<TripReply, { kind: "departure_window" }>["value"]): string {
  return `${DEPARTURE_WINDOW_PREFIX}${value}`;
}

export function passengerCountReplyId(value: Extract<TripReply, { kind: "passengers" }>["value"]): string {
  return `${PASSENGERS_PREFIX}${value}`;
}

export function tripTypeReplyId(value: Extract<TripReply, { kind: "trip_type" }>["value"]): string {
  return `${TRIP_TYPE_PREFIX}${value}`;
}

export function parseTripReplyId(replyId: string | undefined): TripReply | undefined {
  if (!replyId) return undefined;

  if (replyId.startsWith(ORIGIN_PREFIX)) {
    const code = airportByCode(replyId.slice(ORIGIN_PREFIX.length))?.code;
    return code ? { kind: "origin", value: code } : undefined;
  }

  if (replyId.startsWith(DESTINATION_PREFIX)) {
    const code = airportByCode(replyId.slice(DESTINATION_PREFIX.length))?.code;
    return code ? { kind: "destination", value: code } : undefined;
  }

  if (replyId.startsWith(DATE_PREFIX)) {
    const value = replyId.slice(DATE_PREFIX.length);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { kind: "date", value } : undefined;
  }

  if (replyId.startsWith(DEPARTURE_WINDOW_PREFIX)) {
    const value = replyId.slice(DEPARTURE_WINDOW_PREFIX.length);
    if (value === "morning" || value === "afternoon" || value === "evening" || value === "anytime") {
      return { kind: "departure_window", value };
    }
  }

  if (replyId.startsWith(PASSENGERS_PREFIX)) {
    const value = replyId.slice(PASSENGERS_PREFIX.length);
    if (value === "more") return { kind: "passengers", value };
    const adults = Number(value);
    return Number.isInteger(adults) && adults > 0 && adults < 100 ? { kind: "passengers", value: adults } : undefined;
  }

  if (replyId.startsWith(TRIP_TYPE_PREFIX)) {
    const value = replyId.slice(TRIP_TYPE_PREFIX.length);
    if (value === "one_way" || value === "return") return { kind: "trip_type", value };
  }

  if (replyId.startsWith(NEW_TRIP_PREFIX)) {
    const value = replyId.slice(NEW_TRIP_PREFIX.length);
    if (value === "start" || value === "yes" || value === "no") return { kind: "new_trip", value };
  }

  return undefined;
}

export function tripReplySelectedText(reply: TripReply, title: string | undefined): string {
  const labels: Record<TripReply["kind"], string> = {
    origin: "Origin selected",
    destination: "Destination selected",
    date: "Date selected",
    departure_window: "Departure window selected",
    passengers: "Passengers selected",
    trip_type: "Trip type selected",
    new_trip: "New trip selected",
  };
  const trimmedTitle = title?.trim();
  const value = String(reply.value);
  return trimmedTitle ? `${labels[reply.kind]}: ${value} (${trimmedTitle})` : `${labels[reply.kind]}: ${value}`;
}
