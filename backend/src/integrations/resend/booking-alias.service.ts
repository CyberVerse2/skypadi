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
  const prefix = normalizeLocalPartPrefix(input.prefix ?? "book");
  const localPart = `${prefix}_${token}`;

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

function normalizeLocalPartPrefix(prefix: string): string {
  const normalized = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  return normalized || "book";
}
