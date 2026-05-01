import airports from "../../data/wakanow-airports.json";

export type AirportCatalogEntry = {
  code: string;
  city: string;
  airportName: string;
  country: string;
  description?: string;
  cityCountry?: string;
  priority?: number;
};

type WakanowAirportJsonEntry = {
  code: string;
  description: string;
  cityCountry: string;
  city: string;
  country: string;
  priority?: number;
};

const airportCodeAliases: Record<string, string> = {
  LAG: "LOS",
};

export const wakanowAirports: AirportCatalogEntry[] = (airports as WakanowAirportJsonEntry[])
  .map((airport) => ({
    code: airport.code.trim().toUpperCase(),
    city: airport.city.trim(),
    airportName: airportNameFromDescription(airport.description, airport.code),
    country: airport.country.trim(),
    description: airport.description.trim(),
    cityCountry: airport.cityCountry.trim(),
    priority: airport.priority ?? 0,
  }))
  .sort(compareAirports);

export const nigerianOriginAirports: AirportCatalogEntry[] = wakanowAirports
  .filter((airport) => normalizedText(airport.country) === "nigeria")
  .sort(compareAirports);

const preferredWhatsAppOriginCodes = ["LOS", "ABV", "PHC", "KAN", "ENU", "QOW", "ABB", "BNI", "QUO", "QRW"];

export const whatsappOriginRows = preferredWhatsAppOriginCodes.flatMap((code) => {
  const airport = airportByCode(code);
  if (!airport) return [];
  return [
    {
      id: `origin:${airport.code}`,
      title: airport.city,
      description: airport.airportName,
    },
  ];
});

export function airportByCode(code: string): AirportCatalogEntry | undefined {
  const normalizedCode = normalizeAirportCode(code);
  return wakanowAirports.find((airport) => airport.code === normalizedCode);
}

export function normalizeAirportCode(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  return airportCodeAliases[normalizedCode] ?? normalizedCode;
}

export function resolveAirport(input: string): AirportCatalogEntry | undefined {
  const query = input.trim();
  if (!query) return undefined;

  const byCode = airportByCode(query);
  if (byCode) return byCode;

  const normalizedQuery = normalizedText(query);
  return (
    bestAirportMatch((airport) => normalizedText(airport.city) === normalizedQuery) ??
    bestAirportMatch((airport) => normalizedText(airport.airportName) === normalizedQuery) ??
    bestAirportMatch((airport) => normalizedQuery.includes(normalizedText(airport.airportName))) ??
    bestAirportMatch((airport) => normalizedText(airport.description ?? "").includes(normalizedQuery))
  );
}

function bestAirportMatch(predicate: (airport: AirportCatalogEntry) => boolean): AirportCatalogEntry | undefined {
  return wakanowAirports.filter(predicate).sort(compareAirports)[0];
}

function compareAirports(left: AirportCatalogEntry, right: AirportCatalogEntry): number {
  return (right.priority ?? 0) - (left.priority ?? 0)
    || priorityCountry(right.country) - priorityCountry(left.country)
    || left.city.localeCompare(right.city)
    || left.code.localeCompare(right.code);
}

function priorityCountry(country: string): number {
  return normalizedText(country) === "nigeria" ? 1 : 0;
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function airportNameFromDescription(description: string, code: string): string {
  return description.replace(new RegExp(`\\s*\\(${code}\\)\\s*$`, "i"), "").trim();
}
