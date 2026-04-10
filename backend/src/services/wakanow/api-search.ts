import { env } from "../../config.js";
import type {
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSearchResult
} from "../../schemas/flight-search.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const FLIGHTS_API_BASE = "https://flights.wakanow.com/api/flights";
const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 6;
const FETCH_TIMEOUT_MS = 15_000;

const proxyAgent = env.PROXY_URL ? new ProxyAgent(env.PROXY_URL) : undefined;

function proxyFetch(url: string, opts: any = {}): Promise<Response> {
  if (proxyAgent) {
    return undiciFetch(url, { ...opts, dispatcher: proxyAgent }) as any;
  }
  return fetch(url, opts);
}

const AIRPORT_CODES: Record<string, { code: string; description: string; city: string; country: string }> = {
  lagos: { code: "LOS", description: "Murtala Muhammed International Airport (LOS)", city: "Lagos", country: "Nigeria" },
  abuja: { code: "ABV", description: "Nnamdi Azikwe International Airport (ABV)", city: "Abuja", country: "Nigeria" },
  "port harcourt": { code: "PHC", description: "Port Harcourt International Airport (PHC)", city: "Port Harcourt", country: "Nigeria" },
  kano: { code: "KAN", description: "Mallam Aminu Kano International Airport (KAN)", city: "Kano", country: "Nigeria" },
  enugu: { code: "ENU", description: "Akanu Ibiam International Airport (ENU)", city: "Enugu", country: "Nigeria" },
  owerri: { code: "QOW", description: "Sam Mbakwe Airport (QOW)", city: "Owerri", country: "Nigeria" },
  asaba: { code: "ABB", description: "Asaba International Airport (ABB)", city: "Asaba", country: "Nigeria" },
  benin: { code: "BNI", description: "Benin Airport (BNI)", city: "Benin City", country: "Nigeria" },
  uyo: { code: "QUO", description: "Victor Attah International Airport (QUO)", city: "Uyo", country: "Nigeria" },
  warri: { code: "QRW", description: "Osubi Airport (QRW)", city: "Warri", country: "Nigeria" },
  dubai: { code: "DXB", description: "Dubai International Airport (DXB)", city: "Dubai", country: "UAE" },
  london: { code: "LHR", description: "Heathrow Airport (LHR)", city: "London", country: "UK" },
  accra: { code: "ACC", description: "Kotoka International Airport (ACC)", city: "Accra", country: "Ghana" },
  nairobi: { code: "NBO", description: "Jomo Kenyatta International Airport (NBO)", city: "Nairobi", country: "Kenya" },
  johannesburg: { code: "JNB", description: "O.R. Tambo International Airport (JNB)", city: "Johannesburg", country: "South Africa" },
  doha: { code: "DOH", description: "Hamad International Airport (DOH)", city: "Doha", country: "Qatar" },
};

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://www.wakanow.com",
  "Referer": "https://www.wakanow.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
};

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
    TargetCurrency: env.WAKANOW_CURRENCY,
    LanguageCode: "en",
    Itineraries: [itinerary]
  };

  const searchBody = {
    ...flightRequestView,
    FlightRequestView: JSON.stringify(flightRequestView)
  };

  // Step 1: Create search → get request key
  const searchRes = await proxyFetch(`${FLIGHTS_API_BASE}/Search`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(searchBody),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
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
  const currency = env.WAKANOW_CURRENCY;
  let apiData: WakanowApiResponse | null = null;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    const res = await proxyFetch(
      `${FLIGHTS_API_BASE}/SearchV2/${requestKey}/${currency}`,
      { headers: COMMON_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );

    if (!res.ok) {
      if (attempt < MAX_POLLS) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      throw new WakanowApiSearchError("Flight results API returned error.", {
        status: res.status
      });
    }

    const text = await res.text();
    if (!text.startsWith("{")) {
      if (attempt < MAX_POLLS) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      throw new WakanowApiSearchError("Flight results API returned non-JSON.", {
        preview: text.slice(0, 200)
      });
    }

    apiData = JSON.parse(text) as WakanowApiResponse;
    if (apiData.SearchFlightResults && apiData.SearchFlightResults.length > 0) break;

    await sleep(POLL_INTERVAL_MS);
  }

  if (!apiData?.SearchFlightResults?.length) {
    throw new WakanowApiSearchError("No flight results found.", {
      requestKey
    });
  }

  const deeplink = `https://www.wakanow.com/flight/listings/${requestKey}`;
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

// ── API response types ────────────────────────────────────
type WakanowApiResponse = {
  HasResult: boolean;
  SearchFlightResults: WakanowFlightResult[];
};

type WakanowFlightResult = {
  FlightCombination: {
    Flights: Array<{
      AirlineName: string;
      Airline: string;
      DepartureCode: string;
      DepartureName: string;
      DepartureTime: string;
      ArrivalCode: string;
      ArrivalName: string;
      ArrivalTime: string;
      Stops: number;
      TripDuration: string;
    }>;
    Price: {
      Amount: number;
      CurrencyCode: string;
    };
    Source: string;
  };
  FlightId: string;
};

// ── Helpers ───────────────────────────────────────────────

function mapFlightResult(r: WakanowFlightResult, deeplink: string, searchKey: string): FlightSearchResult {
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
  const key = input.toLowerCase().trim();
  const match = AIRPORT_CODES[key];
  if (match) return match;

  // Check if input is already an airport code
  const upper = input.toUpperCase().trim();
  for (const airport of Object.values(AIRPORT_CODES)) {
    if (airport.code === upper) return airport;
  }

  // Default: use input as-is (3-letter code)
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
