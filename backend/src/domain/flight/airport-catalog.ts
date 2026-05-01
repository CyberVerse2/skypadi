export type AirportCatalogEntry = {
  code: string;
  city: string;
  airportName: string;
  country: string;
};

export const nigerianOriginAirports: AirportCatalogEntry[] = [
  { code: "LOS", city: "Lagos", airportName: "Murtala Muhammed Airport", country: "Nigeria" },
  { code: "ABV", city: "Abuja", airportName: "Nnamdi Azikiwe Airport", country: "Nigeria" },
  { code: "PHC", city: "Port Harcourt", airportName: "Port Harcourt Airport", country: "Nigeria" },
  { code: "KAN", city: "Kano", airportName: "Mallam Aminu Kano Airport", country: "Nigeria" },
  { code: "ENU", city: "Enugu", airportName: "Akanu Ibiam Airport", country: "Nigeria" },
  { code: "QOW", city: "Owerri", airportName: "Sam Mbakwe Airport", country: "Nigeria" },
  { code: "ABB", city: "Asaba", airportName: "Asaba Airport", country: "Nigeria" },
  { code: "BNI", city: "Benin", airportName: "Benin Airport", country: "Nigeria" },
  { code: "QUO", city: "Uyo", airportName: "Victor Attah Airport", country: "Nigeria" },
  { code: "QRW", city: "Warri", airportName: "Osubi Airport", country: "Nigeria" },
];

export const whatsappOriginRows = nigerianOriginAirports.map((airport) => ({
  id: `origin:${airport.code}`,
  title: airport.city,
  description: airport.airportName,
}));

const airportCodeAliases: Record<string, string> = {
  LAG: "LOS",
};

export function airportByCode(code: string): AirportCatalogEntry | undefined {
  const normalizedCode = normalizeAirportCode(code);
  return nigerianOriginAirports.find((airport) => airport.code === normalizedCode);
}

export function normalizeAirportCode(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  return airportCodeAliases[normalizedCode] ?? normalizedCode;
}
