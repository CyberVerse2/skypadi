import type {
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSearchResult
} from "../../schemas/flight-search";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { normalizeAirportCode, resolveAirport as resolveCatalogAirport } from "../../domain/flight/airport-catalog";
import { wakanowCommonHeaders, wakanowConfig } from "./wakanow.config";
import type { WakanowApiFlightResult, WakanowApiSearchResponse } from "./wakanow.types";

const proxyAgent = wakanowConfig.proxyUrl ? new ProxyAgent(wakanowConfig.proxyUrl) : undefined;

function proxyFetch(url: string, opts: any = {}): Promise<Response> {
  if (proxyAgent) {
    return undiciFetch(url, { ...opts, dispatcher: proxyAgent }) as any;
  }
  return fetch(url, opts);
}

const COMMON_HEADERS = wakanowCommonHeaders({ contentType: "json" });

export class WakanowApiSearchError extends Error {
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WakanowApiSearchError";
    this.details = details;
  }
}

export async function searchFlightsApi(
  request: FlightSearchRequest
): Promise<FlightSearchResponse> {
  const origin = resolveAirport(request.origin);
  const destination = resolveAirport(request.destination);

  const isRoundTrip = Boolean(request.returnDate);
  const itinerary: Record<string, unknown> = {
    Ticketclass: "Y",
    Departure: origin.code,
    Destination: destination.code,
    DepartureDate: formatWakanowDate(request.departureDate),
    DepartureMetaData: {
      AirportCode: origin.code,
      Description: origin.description,
      CityCountry: `${origin.city}, ${origin.country}`,
      City: origin.city,
      Country: origin.country
    },
    DestinationMetaData: {
      AirportCode: destination.code,
      Description: destination.description,
      CityCountry: `${destination.city}, ${destination.country}`,
      City: destination.city,
      Country: destination.country
    }
  };

  if (isRoundTrip) {
    itinerary.ReturnDate = formatWakanowDate(request.returnDate!);
  }

  // Build the FlightRequestView (stringified version of the full request, as Wakanow expects)
  const flightRequestView = {
    FlightSearchType: isRoundTrip ? "Return" : "Oneway",
    Ticketclass: "Y",
    FlexibleDateFlag: "false",
    Adults: 1,
    Children: 0,
    Infants: 0,
    GeographyId: "NG",
    TargetCurrency: wakanowConfig.currency,
    LanguageCode: "en",
    Itineraries: [itinerary]
  };

  const searchBody = {
    ...flightRequestView,
    FlightRequestView: JSON.stringify(flightRequestView)
  };

  // Step 1: Create search → get request key
  const searchRes = await proxyFetch(`${wakanowConfig.search.apiBaseUrl}/Search`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(searchBody),
    signal: AbortSignal.timeout(wakanowConfig.search.fetchTimeoutMs)
  });

  const keyText = await searchRes.text();
  const requestKey = keyText.replace(/"/g, "").trim();

  if (!requestKey || requestKey.includes("Message") || requestKey.includes("<")) {
    throw new WakanowApiSearchError("Failed to create flight search.", {
      status: searchRes.status,
      response: keyText.slice(0, 200)
    });
  }

  // Step 2: Poll for results
  const currency = wakanowConfig.currency;
  let apiData: WakanowApiSearchResponse | null = null;

  for (let attempt = 1; attempt <= wakanowConfig.search.maxPolls; attempt++) {
    const res = await proxyFetch(
      `${wakanowConfig.search.apiBaseUrl}/SearchV2/${requestKey}/${currency}`,
      { headers: COMMON_HEADERS, signal: AbortSignal.timeout(wakanowConfig.search.fetchTimeoutMs) }
    );

    if (!res.ok) {
      if (attempt < wakanowConfig.search.maxPolls) {
        await sleep(wakanowConfig.search.pollIntervalMs);
        continue;
      }
      throw new WakanowApiSearchError("Flight results API returned error.", {
        status: res.status
      });
    }

    const text = await res.text();
    if (!text.startsWith("{")) {
      if (attempt < wakanowConfig.search.maxPolls) {
        await sleep(wakanowConfig.search.pollIntervalMs);
        continue;
      }
      throw new WakanowApiSearchError("Flight results API returned non-JSON.", {
        preview: text.slice(0, 200)
      });
    }

    apiData = JSON.parse(text) as WakanowApiSearchResponse;
    if (apiData.SearchFlightResults && apiData.SearchFlightResults.length > 0) break;

    await sleep(wakanowConfig.search.pollIntervalMs);
  }

  if (!apiData?.SearchFlightResults?.length) {
    throw new WakanowApiSearchError("No flight results found.", {
      requestKey
    });
  }

  const deeplink = `${wakanowConfig.webOrigin}/en-ng/flight/listings/${requestKey}`;
  const results = apiData.SearchFlightResults
    .slice(0, request.maxResults)
    .map((r) => mapFlightResult(r, deeplink, requestKey));

  return {
    provider: "wakanow",
    searchedAt: new Date().toISOString(),
    request,
    resultCount: results.length,
    results
  };
}

// ── Helpers ───────────────────────────────────────────────

function mapFlightResult(r: WakanowApiFlightResult, deeplink: string, searchKey: string): FlightSearchResult {
  const flight = r.FlightCombination.Flights[0];
  const price = r.FlightCombination.Price;

  const depTime = flight.DepartureTime.split("T")[1]?.slice(0, 5) ?? null;
  const arrTime = flight.ArrivalTime.split("T")[1]?.slice(0, 5) ?? null;

  const duration = parseDuration(flight.TripDuration);
  const stops = flight.Stops === 0 ? "non-stop" : `${flight.Stops} stop${flight.Stops > 1 ? "s" : ""}`;

  const currency = price.CurrencyCode === "NGN" ? "\u20A6" : price.CurrencyCode;
  const priceText = `${currency}${price.Amount.toLocaleString()}`;

  return {
    airline: flight.AirlineName,
    priceText,
    departureTime: depTime,
    arrivalTime: arrTime,
    duration,
    stops,
    deeplink,
    rawText: `${flight.AirlineName} ${depTime}-${arrTime} ${priceText}`,
    flightId: r.FlightId,
    searchKey
  };
}

function resolveAirport(input: string) {
  const match = resolveCatalogAirport(input);
  if (match) {
    return {
      code: match.code,
      description: match.description ?? `${match.airportName} (${match.code})`,
      city: match.city,
      country: match.country,
    };
  }

  // Default: use input as-is (3-letter code)
  const upper = normalizeAirportCode(input);
  if (upper.length === 3) {
    return {
      code: upper,
      description: `${upper} Airport`,
      city: input,
      country: "Unknown"
    };
  }

  throw new WakanowApiSearchError(`Unknown airport: "${input}". Use city name or 3-letter code.`);
}

function formatWakanowDate(isoDate: string): string {
  // Convert "2026-04-25" → "4/25/2026"
  const [year, month, day] = isoDate.split("-");
  return `${parseInt(month)}/${parseInt(day)}/${year}`;
}

function parseDuration(tripDuration: string): string | null {
  // "01:15:00" → "1h 15m"
  const match = tripDuration.match(/^(\d+):(\d+)/);
  if (!match) return null;
  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
