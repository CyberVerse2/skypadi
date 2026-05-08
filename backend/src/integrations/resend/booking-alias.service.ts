import { randomBytes } from "node:crypto";

export type BookingAliasInput = {
  domain: string;
  prefix?: string;
  idGenerator?: () => string;
};

export type BookingAlias = {
  emailAddress: string;
  localPart: string;
  domain: string;
};

export function generateBookingEmailAlias(input: BookingAliasInput): BookingAlias {
  const domain = normalizeDomain(input.domain);
  const token = normalizeToken(input.idGenerator?.() ?? randomBytes(8).toString("hex"));
  const localPart = humanReadableLocalPart(token, input.prefix);

  return {
    emailAddress: `${localPart}@${domain}`,
    localPart,
    domain,
  };
}

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(normalized) || !normalized.includes(".")) {
    throw new Error("Booking alias domain must be a valid email domain");
  }

  return normalized;
}

function normalizeToken(token: string): string {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);

  if (!normalized) {
    throw new Error("Booking alias token must contain at least one alphanumeric character");
  }

  return normalized;
}

function humanReadableLocalPart(token: string, prefix?: string): string {
  const firstNames = ["amaka", "nkiru", "mariam", "zainab", "tolu", "bassey", "kunle", "chioma"];
  const lastNames = ["okafor", "obi", "sani", "bello", "adebayo", "etim", "fashola", "nwachukwu"];
  const seed = Array.from(token).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const first = firstNames[seed % firstNames.length]!;
  const last = lastNames[Math.floor(seed / firstNames.length) % lastNames.length]!;
  const suffix = token.slice(0, 6);
  const normalizedPrefix = normalizeLocalPartSegment(prefix ?? "");

  return [first, last, normalizedPrefix === "book" ? undefined : normalizedPrefix, suffix]
    .filter(Boolean)
    .join(".");
}

function normalizeLocalPartSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 20);
}
