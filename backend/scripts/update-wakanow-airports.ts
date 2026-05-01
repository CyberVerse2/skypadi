import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type WakanowAirportResponse = {
  AirportCode?: string;
  Description?: string;
  CityCountry?: string;
  City?: string;
  Country?: string;
  Prority?: number;
};

type AirportCatalogEntry = {
  code: string;
  description: string;
  cityCountry: string;
  city: string;
  country: string;
  priority: number;
};

const ENDPOINT = "https://wakanow-api-locations-production-prod.azurewebsites.net/api/locations/airport";
const CONCURRENCY = 8;
const OUTPUT_PATH = join(process.cwd(), "src/data/wakanow-airports.json");
const EXTRA_QUERIES = [
  "lagos",
  "abuja",
  "port harcourt",
  "kano",
  "enugu",
  "owerri",
  "asaba",
  "benin",
  "uyo",
  "warri",
  "ibadan",
  "kaduna",
  "jos",
  "calabar",
  "yola",
  "maiduguri",
  "sokoto",
  "minna",
  "bauchi",
  "ilorin",
  "akure",
];

async function main() {
  const full = process.argv.includes("--full");
  const queries = full ? fullQueries() : defaultQueries();
  const seen = new Map<string, AirportCatalogEntry>();

  await mapWithConcurrency(queries, CONCURRENCY, async (query) => {
    for (const airport of await fetchAirports(query)) {
      if (!airport.code || seen.has(airport.code)) continue;
      seen.set(airport.code, airport);
    }
  });

  const airports = [...seen.values()].sort(compareAirports);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(airports, null, 2)}\n`);
  console.log(`Wrote ${airports.length} Wakanow airports to ${OUTPUT_PATH}`);
}

function defaultQueries(): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  return unique([
    ...letters,
    ...letters.flatMap((first) => letters.map((second) => `${first}${second}`)),
    ...EXTRA_QUERIES,
  ]);
}

function fullQueries(): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  return unique([
    ...defaultQueries(),
    ...letters.flatMap((first) => letters.flatMap((second) => letters.map((third) => `${first}${second}${third}`))),
  ]);
}

async function fetchAirports(query: string): Promise<AirportCatalogEntry[]> {
  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(query)}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.wakanow.com",
      Referer: "https://www.wakanow.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Wakanow airport lookup failed for "${query}" with ${response.status}`);
  }

  const data = await response.json() as unknown;
  if (!Array.isArray(data)) return [];

  return data.map(normalizeAirport).filter((airport): airport is AirportCatalogEntry => Boolean(airport));
}

function normalizeAirport(airport: WakanowAirportResponse): AirportCatalogEntry | undefined {
  const code = airport.AirportCode?.trim().toUpperCase();
  const city = airport.City?.trim();
  const country = airport.Country?.trim();
  const description = airport.Description?.trim();
  const cityCountry = airport.CityCountry?.trim();
  if (!code || !city || !country || !description || !cityCountry) return undefined;

  return {
    code,
    description,
    cityCountry,
    city,
    country,
    priority: airport.Prority ?? 0,
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const item = items[index]!;
      index += 1;
      await mapper(item);
    }
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compareAirports(left: AirportCatalogEntry, right: AirportCatalogEntry): number {
  return priorityCountry(right.country) - priorityCountry(left.country)
    || right.priority - left.priority
    || left.city.localeCompare(right.city)
    || left.code.localeCompare(right.code);
}

function priorityCountry(country: string): number {
  return country.trim().toLowerCase() === "nigeria" ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
