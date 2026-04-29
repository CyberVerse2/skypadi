import type { SupplierHoldResult } from "./wakanow.types.js";
import type { DbClient } from "../../db/client.js";
import type { Passenger } from "../../schemas/flight-booking.js";
import { bookFlightApi } from "./api-book.js";
import { sql } from "drizzle-orm";
import { createDrizzleInboundEmailRepository } from "../../domain/inbound-email/inbound-email.repository.js";
import { waitForInboundEmailOtp } from "../../workflows/inbound-email.workflow.js";

export type WakanowHoldClient = {
  createHold(input: WakanowHoldRequest): Promise<SupplierHoldResult>;
};

export type WakanowHoldRequest = {
  bookingId: string;
  selectedFlightOptionId: string;
  passengerSnapshot: Record<string, unknown>;
  contactEmail: string;
};

export function createWakanowBrowserHoldClient(input: { db: DbClient }): WakanowHoldClient {
  return {
    async createHold(request) {
      const option = await findWakanowOption(input.db, request.selectedFlightOptionId);
      const passenger = passengerFromSnapshot(request.passengerSnapshot, request.contactEmail);
      const result = await bookFlightApi({
        bookingId: request.bookingId,
        searchKey: option.searchKey,
        flightId: option.flightId,
        deeplink: option.deeplink,
        passenger,
        resolveOtp: async () => waitForInboundEmailOtp({
          bookingId: request.bookingId,
          repository: createDrizzleInboundEmailRepository(input.db),
        }),
      });

      return {
        kind: "hold_created",
        supplier: "wakanow",
        supplierBookingRef: result.bookingId,
        expiresAt: holdExpiryFromBankTransfer(result.bankTransfers?.[0]?.expiresIn),
        amountDue: result.flightSummary.price,
        currency: "NGN",
        paymentUrl: result.paymentUrl,
        rawStatus: result.status,
      };
    },
  };
}

export function normalizeWakanowHoldStatus(input: {
  status: string;
  supplierBookingRef?: string;
  expiresAt?: Date | string;
  amountDue?: number;
  currency?: "NGN";
  paymentUrl?: string;
  reason?: string;
}): SupplierHoldResult {
  const rawStatus = input.status;
  const normalized = rawStatus.trim().toLowerCase();

  if (normalized === "active" || normalized === "hold_created") {
    const expiresAt = parseSupplierDate(input.expiresAt);
    if (!input.supplierBookingRef || !expiresAt || !hasPositiveAmount(input.amountDue)) {
      return unclear(rawStatus, input.reason ?? "Supplier hold response was missing required booking details");
    }

    return {
      kind: "hold_created",
      supplier: "wakanow",
      supplierBookingRef: input.supplierBookingRef,
      expiresAt,
      amountDue: input.amountDue,
      currency: input.currency ?? "NGN",
      paymentUrl: input.paymentUrl,
      rawStatus,
    };
  }

  if (normalized === "instantpurchase" || normalized === "instant_purchase_required") {
    if (!hasPositiveAmount(input.amountDue)) {
      return unclear(rawStatus, input.reason ?? "Instant-purchase response was missing amount due");
    }

    return {
      kind: "instant_purchase_required",
      supplier: "wakanow",
      reason: input.reason ?? "Supplier requires instant purchase",
      amountDue: input.amountDue,
      currency: input.currency ?? "NGN",
      rawStatus,
    };
  }

  if (normalized === "holdunavailable" || normalized === "hold_unavailable") {
    return {
      kind: "hold_unavailable",
      supplier: "wakanow",
      reason: input.reason ?? "Supplier did not offer a hold",
      amountDue: input.amountDue,
      currency: input.currency,
      rawStatus,
    };
  }

  return unclear(rawStatus, input.reason ?? "Supplier hold status was not recognized");
}

function unclear(rawStatus: string, reason: string): SupplierHoldResult {
  return {
    kind: "unclear",
    supplier: "wakanow",
    reason,
    rawStatus,
  };
}

function parseSupplierDate(value: Date | string | undefined): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function hasPositiveAmount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function findWakanowOption(db: DbClient, selectedFlightOptionId: string): Promise<{
  searchKey: string;
  flightId: string;
  deeplink?: string;
}> {
  const result = await db.execute(sql`
    select supplier_payload
    from skypadi_whatsapp.flight_options
    where id = ${selectedFlightOptionId}
      and supplier = 'wakanow'
    limit 1
  `);
  const row = result.rows[0] as { supplier_payload?: Record<string, unknown> } | undefined;
  const payload = row?.supplier_payload;
  const searchKey = stringValue(payload?.searchKey);
  const flightId = stringValue(payload?.flightId);
  const deeplink = stringValue(payload?.deeplink);
  if (!searchKey || !flightId) {
    throw new Error("Selected Wakanow flight option is missing booking payload");
  }

  return { searchKey, flightId, deeplink };
}

function passengerFromSnapshot(snapshot: Record<string, unknown>, contactEmail: string): Passenger {
  return {
    title: stringValue(snapshot.title) as Passenger["title"],
    firstName: stringValue(snapshot.firstName) ?? "",
    middleName: stringValue(snapshot.middleName),
    lastName: stringValue(snapshot.lastName) ?? "",
    dateOfBirth: stringValue(snapshot.dateOfBirth) ?? "",
    nationality: stringValue(snapshot.nationality) ?? "Nigerian",
    gender: stringValue(snapshot.gender) as Passenger["gender"],
    phone: stringValue(snapshot.phone) ?? "",
    email: contactEmail,
  };
}

function holdExpiryFromBankTransfer(expiresIn: string | undefined): Date {
  const hours = Number(expiresIn?.match(/(\d+)\s*hours?/i)?.[1] ?? 9);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
