/**
 * Parse natural-language flight search messages.
 * Examples:
 *   "Lagos to Abuja on April 25"
 *   "Lagos to Abuja on April 25 return May 2"
 *   "fly from Abuja to Lagos 2026-05-10 returning 2026-05-15"
 *   "search PHC to LOS on 25th April 2026"
 *   "round trip Lagos to Abuja April 25 to May 2"
 */

const CITY_ALIASES: Record<string, string> = {
  los: "Lagos",
  abv: "Abuja",
  phc: "Port Harcourt",
  ph: "Port Harcourt",
  dxb: "Dubai",
  doh: "Doha",
  lhr: "London",
  jnb: "Johannesburg"
};

type ParsedSearch = {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD
};

export function parseSearchMessage(text: string): ParsedSearch | null {
  const lower = text.toLowerCase().trim();

  // Strip common preamble: "a flight from", "find me a flight from", "I want to fly from", etc.
  const cleaned = lower
    .replace(/^(?:i\s+(?:want|need)\s+(?:to\s+)?)?/, "")
    .replace(/^(?:(?:search|find|book|get)\s+(?:me\s+)?)?/, "")
    .replace(/^(?:a\s+)?(?:flight|flights|ticket|tickets)\s+/, "")
    .replace(/^(?:from\s+)/, "")
    .trim();

  // Match: "X to Y on <date> [return/returning/back <date>]"
  const routeMatch = cleaned.match(
    /^(\w[\w\s]*?)\s+to\s+(\w[\w\s]*?)(?:\s+on)?\s+(.+)$/i
  );
  if (!routeMatch) return null;

  const origin = normalizeCity(routeMatch[1].trim());
  const destination = normalizeCity(routeMatch[2].trim());
  const datesPart = routeMatch[3].trim();

  // Try to split into departure + return date
  // Patterns: "April 25 return May 2", "April 25 returning May 2", "April 25 back May 2"
  //           "April 25 to May 2", "April 25 - May 2", "2026-04-25 to 2026-05-02"
  const returnSplit = datesPart.match(
    /^(.+?)\s+(?:return(?:ing)?|back|to|-)\s+(.+)$/i
  );

  if (returnSplit) {
    const departureDate = parseDate(returnSplit[1].trim());
    const returnDate = parseDate(returnSplit[2].trim());
    if (!departureDate) return null;
    if (!returnDate) return null;
    return { origin, destination, departureDate, returnDate };
  }

  // One-way: just a single date
  const departureDate = parseDate(datesPart);
  if (!departureDate) return null;

  return { origin, destination, departureDate };
}

function normalizeCity(input: string): string {
  const key = input.toLowerCase().replace(/\s+/g, " ");
  return CITY_ALIASES[key] ?? capitalize(key);
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

function parseDate(input: string): string | null {
  // ISO format: 2026-04-25
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return input;

  // "April 25 2026" / "25 April 2026" / "April 25" / "25th April"
  const cleaned = input.replace(/(st|nd|rd|th)/gi, "").trim();

  // Try: "Month Day Year" or "Month Day"
  const mdyMatch = cleaned.match(
    /^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/i
  );
  if (mdyMatch) {
    const month = MONTHS[mdyMatch[1].toLowerCase()];
    if (!month) return null;
    const day = parseInt(mdyMatch[2]);
    const year = mdyMatch[3] ? parseInt(mdyMatch[3]) : new Date().getFullYear();
    return formatDate(year, month, day);
  }

  // Try: "Day Month Year" or "Day Month"
  const dmyMatch = cleaned.match(
    /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i
  );
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const month = MONTHS[dmyMatch[2].toLowerCase()];
    if (!month) return null;
    const year = dmyMatch[3] ? parseInt(dmyMatch[3]) : new Date().getFullYear();
    return formatDate(year, month, day);
  }

  // Try: "DD/MM/YYYY" or "DD-MM-YYYY"
  const slashMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    return formatDate(
      parseInt(slashMatch[3]),
      parseInt(slashMatch[2]),
      parseInt(slashMatch[1])
    );
  }

  return null;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
