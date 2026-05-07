import type {
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSearchResult
} from "../../schemas/flight-search";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { normalizeAirportCode, resolveAirport as resolveCatalogAirport } from "../../domain/flight/airport-catalog";
import { createWakanowSearchWithBrowser, getWakanowBrowserCookieHeader } from "./browser-session";
import { wakanowCommonHeaders, wakanowConfig } from "./wakanow.config";
import type { WakanowApiFlightResult, WakanowApiSearchResponse } from "./wakanow.types";

type SearchTransport = {
  label: string;
  proxyUrl?: string;
  dispatcher?: ProxyAgent;
};

const searchTransports = createSearchTransports(wakanowConfig.proxyUrls);
let nextTransportIndex = 0;

function proxyFetch(url: string, opts: any = {}, transport: SearchTransport = nextSearchTransport()): Promise<Response> {
  if (transport.dispatcher) {
    return undiciFetch(url, { ...opts, dispatcher: transport.dispatcher }) as any;
  }
  return fetch(url, opts);
}

function nextSearchTransport(): SearchTransport {
  const transport = searchTransports[nextTransportIndex % searchTransports.length]!;
  nextTransportIndex += 1;
  return transport;
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
  const itineraries = [
    createItinerary({
      departure: origin,
      destination,
      departureDate: request.departureDate
    })
  ];

  if (isRoundTrip) {
    itineraries.push(
      createItinerary({
        departure: destination,
        destination: origin,
        departureDate: request.returnDate!
      })
    );
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
    Itineraries: itineraries
  };

  const searchBody = {
    ...flightRequestView,
    FlightRequestView: JSON.stringify(flightRequestView)
  };

  // Step 1: Create search → get request key
  const { requestKey, transport, apiData: browserApiData } = await createSearchRequest(searchBody);

  // Step 2: Poll for results
  const currency = wakanowConfig.currency;
  let apiData: WakanowApiSearchResponse | null = browserApiData ?? null;
  const pollHeaders = await headersForTransport(transport);

  for (let attempt = 1; !apiData?.SearchFlightResults?.length && attempt <= wakanowConfig.search.maxPolls; attempt++) {
    let res: Response;
    try {
      res = await proxyFetch(
        `${wakanowConfig.search.apiBaseUrl}/SearchV2/${requestKey}/${currency}`,
        { headers: pollHeaders, signal: AbortSignal.timeout(wakanowConfig.search.fetchTimeoutMs) },
        transport
      );
    } catch (error) {
      if (attempt < wakanowConfig.search.maxPolls) {
        await sleep(wakanowConfig.search.pollIntervalMs);
        continue;
      }
      throw new WakanowApiSearchError("Flight results API request failed.", {
        requestKey,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

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

async function createSearchRequest(searchBody: Record<string, unknown>): Promise<{
  requestKey: string;
  transport: SearchTransport;
  apiData?: WakanowApiSearchResponse;
}> {
  let lastError: WakanowApiSearchError | undefined;
  const maxAttempts = Math.max(searchTransports.length, 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transport = nextSearchTransport();

    if (transport.proxyUrl) {
      const browserResult = await tryCreateSearchWithBrowser({
        transport,
        searchBody,
        attempt,
        maxAttempts,
      });
      if (browserResult) return browserResult;
    }

    let searchRes: Response;
    try {
      const headers = await headersForTransport(transport);
      searchRes = await proxyFetch(
        `${wakanowConfig.search.apiBaseUrl}/Search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(searchBody),
          signal: AbortSignal.timeout(wakanowConfig.search.fetchTimeoutMs)
        },
        transport
      );
    } catch (error) {
      lastError = new WakanowApiSearchError("Failed to create flight search.", {
        cause: error instanceof Error ? error.message : String(error),
        proxyAttempt: transport.label,
        proxyAttemptNumber: attempt,
        proxyAttemptCount: maxAttempts
      });

      if (transport.proxyUrl) {
        const browserResult = await tryCreateSearchWithBrowser({
          transport,
          searchBody,
          attempt,
          maxAttempts,
          priorDetails: lastError.details,
        });
        if (browserResult) return browserResult;
      }

      if (attempt === maxAttempts) throw lastError;
      continue;
    }

    const keyText = await searchRes.text();
    const requestKey = keyText.replace(/"/g, "").trim();

    if (requestKey && !requestKey.includes("Message") && !requestKey.includes("<")) {
      return { requestKey, transport };
    }

    lastError = new WakanowApiSearchError("Failed to create flight search.", {
      status: searchRes.status,
      response: keyText.slice(0, 200),
      proxyAttempt: transport.label,
      proxyAttemptNumber: attempt,
      proxyAttemptCount: maxAttempts
    });

    if (transport.proxyUrl && isRetryableCreateSearchFailure(searchRes.status, keyText)) {
      const browserResult = await tryCreateSearchWithBrowser({
        transport,
        searchBody,
        attempt,
        maxAttempts,
        priorDetails: {
          status: searchRes.status,
          response: keyText.slice(0, 200),
        },
      });
      if (browserResult) return browserResult;
    }

    if (!isRetryableCreateSearchFailure(searchRes.status, keyText) || attempt === maxAttempts) {
      throw lastError;
    }
  }

  throw lastError ?? new WakanowApiSearchError("Failed to create flight search.");
}

async function tryCreateSearchWithBrowser(input: {
  transport: SearchTransport;
  searchBody: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  priorDetails?: Record<string, unknown>;
}): Promise<{ requestKey: string; transport: SearchTransport; apiData?: WakanowApiSearchResponse } | undefined> {
  try {
    const browserResult = await createWakanowSearchWithBrowser({
      proxyUrl: input.transport.proxyUrl,
      searchUrl: `${wakanowConfig.search.apiBaseUrl}/Search`,
      searchBody: input.searchBody,
    });
    const browserRequestKey = browserResult.text.replace(/"/g, "").trim();

    if (
      browserRequestKey &&
      !browserRequestKey.includes("Message") &&
      !browserRequestKey.includes("<")
    ) {
      return { requestKey: browserRequestKey, transport: input.transport, apiData: browserResult.searchData };
    }
  } catch (error) {
    throw new WakanowApiSearchError("Failed to create flight search.", {
      ...input.priorDetails,
      browserFallbackCause: error instanceof Error ? error.message : String(error),
      proxyAttempt: `${input.transport.label}:browser`,
      proxyAttemptNumber: input.attempt,
      proxyAttemptCount: input.maxAttempts,
    });
  }

  return undefined;
}

function isRetryableCreateSearchFailure(status: number, body: string): boolean {
  return status === 403 || status === 429 || status >= 500 || /NOINDEX,\s*NOFOLLOW|access denied|forbidden/i.test(body);
}

function createSearchTransports(proxyUrls: string[]): SearchTransport[] {
  if (proxyUrls.length === 0) return [{ label: "direct" }];
  return proxyUrls.map((proxyUrl, index) => ({
    label: `proxy-${index + 1}`,
    proxyUrl,
    dispatcher: new ProxyAgent(proxyUrl)
  }));
}

async function headersForTransport(transport: SearchTransport): Promise<Record<string, string>> {
  const cookie = await getWakanowBrowserCookieHeader(transport.proxyUrl);
  return cookie ? { ...COMMON_HEADERS, Cookie: cookie } : COMMON_HEADERS;
}

function mapFlightResult(r: WakanowApiFlightResult, deeplink: string, searchKey: string): FlightSearchResult {
  const flight = r.FlightCombination.Flights[0];
  const price = r.FlightCombination.Price;

  const depTime = flight.DepartureTime.split("T")[1]?.slice(0, 5) ?? null;
  const arrTime = flight.ArrivalTime.split("T")[1]?.slice(0, 5) ?? null;
  const departureDate = isoDateFromDateTime(flight.DepartureTime);
  const arrivalDate = isoDateFromDateTime(flight.ArrivalTime);

  const duration = parseDuration(flight.TripDuration);
  const stops = flight.Stops === 0 ? "non-stop" : `${flight.Stops} stop${flight.Stops > 1 ? "s" : ""}`;

  const currency = price.CurrencyCode === "NGN" ? "\u20A6" : price.CurrencyCode;
  const priceText = `${currency}${price.Amount.toLocaleString()}`;

  return {
    airline: flight.AirlineName,
    priceText,
    departureDate,
    arrivalDate,
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

function isoDateFromDateTime(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return match?.[1] ?? null;
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

type ResolvedAirport = ReturnType<typeof resolveAirport>;

function createItinerary(input: {
  departure: ResolvedAirport;
  destination: ResolvedAirport;
  departureDate: string;
}): Record<string, unknown> {
  return {
    Ticketclass: "Y",
    Departure: input.departure.code,
    Destination: input.destination.code,
    DepartureDate: formatWakanowDate(input.departureDate),
    DepartureMetaData: airportMetadata(input.departure),
    DestinationMetaData: airportMetadata(input.destination)
  };
}

function airportMetadata(airport: ResolvedAirport): Record<string, string> {
  return {
    AirportCode: airport.code,
    Description: airport.description,
    CityCountry: `${airport.city}, ${airport.country}`,
    City: airport.city,
    Country: airport.country
  };
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
