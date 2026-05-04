import type { SupplierHoldResult, WakanowHoldClient, WakanowHoldRequest, WakanowSupplierBookingState } from "./wakanow.types";
import type { DbClient } from "../../db/client";
import type { Passenger } from "../../schemas/flight-booking";
import { assignWakanowAccountForBooking } from "./account-assignment";
import { wakanowAccountPoolFromEnv } from "./account-auth";
import { bookFlightWithWakanowApi } from "./api-booking";
import { sql } from "drizzle-orm";
import { createDrizzleInboundEmailRepository } from "../../domain/inbound-email/inbound-email.repository";
import type { BankTransferDetails } from "../../schemas/booking-contract";
import { waitForInboundEmailOtp } from "../../workflows/inbound-email.workflow";

export type { WakanowHoldClient, WakanowHoldRequest } from "./wakanow.types";

export function createWakanowApiHoldClient(input: { db: DbClient }): WakanowHoldClient {
  const client: WakanowHoldClient = {
    async createHold(request) {
      const option = await findWakanowOption(input.db, request.selectedFlightOptionId);
      const passenger = passengerFromSnapshot(request.passengerSnapshot, request.contactEmail);
      const accountCredentials = await assignWakanowAccountForBooking({
        db: input.db,
        bookingId: request.bookingId,
        accountPool: wakanowAccountPoolFromEnv(),
      });
      const result = await bookFlightWithWakanowApi({
        bookingId: request.bookingId,
        searchKey: option.searchKey,
        flightId: option.flightId,
        passenger,
        contactEmail: request.contactEmail,
        supplierState: request.supplierBookingState,
        resolveOtp: async () => waitForInboundEmailOtp({
          bookingId: request.bookingId,
          repository: createDrizzleInboundEmailRepository(input.db),
        }),
      }, {
        accountCredentials,
        onStateChange: async (state) => {
          await persistWakanowSupplierBookingState(input.db, request.bookingId, state);
        },
      });

      return {
        kind: "hold_created",
        supplier: "wakanow",
        supplierBookingRef: result.bookingId,
        expiresAt: holdExpiryFromBankTransfer(result.bankTransfers?.[0]?.expiresIn),
        amountDue: result.flightSummary.price,
        currency: "NGN",
        paymentUrl: result.paymentUrl,
        bankTransfers: result.bankTransfers,
        rawStatus: result.rawStatus,
      };
    },
    async createHoldForBooking(request) {
      return client.createHold(await findReadyBookingForSupplierHold(input.db, request.bookingId));
    },
  };

  return client;
}

export function createWakanowApiFirstHoldClient(input: { db: DbClient }): WakanowHoldClient {
  return createWakanowApiHoldClient(input);
}

export function normalizeWakanowHoldStatus(input: {
  status: string;
  supplierBookingRef?: string;
  expiresAt?: Date | string;
  amountDue?: number;
  currency?: "NGN";
  paymentUrl?: string;
  bankTransfers?: BankTransferDetails[];
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
      bankTransfers: input.bankTransfers,
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

async function findReadyBookingForSupplierHold(db: DbClient, bookingId: string): Promise<WakanowHoldRequest> {
  const result = await db.execute(sql`
    select
      b.id,
      b.selected_flight_option_id,
      b.supplier_booking_state,
      bp.snapshot,
      bea.email_address
    from skypadi_whatsapp.bookings b
    inner join skypadi_whatsapp.booking_passengers bp
      on bp.booking_id = b.id
      and bp.passenger_type = 'adult'
    inner join skypadi_whatsapp.booking_email_aliases bea
      on bea.booking_id = b.id
      and bea.status = 'active'
    where b.id = ${bookingId}
      and b.status = 'supplier_booking_pending'
    order by bp.created_at asc
    limit 1
  `);
  const row = result.rows[0] as
    | {
        id: string;
        selected_flight_option_id: string | null;
        supplier_booking_state?: WakanowSupplierBookingState;
        snapshot: Record<string, unknown>;
        email_address: string;
      }
    | undefined;

  if (!row?.selected_flight_option_id) {
    throw new Error("Booking is not ready for supplier hold");
  }

  return {
    bookingId: row.id,
    selectedFlightOptionId: row.selected_flight_option_id,
    passengerSnapshot: row.snapshot,
    contactEmail: row.email_address,
    supplierBookingState: row.supplier_booking_state,
  };
}

async function persistWakanowSupplierBookingState(
  db: DbClient,
  bookingId: string,
  state: WakanowSupplierBookingState,
): Promise<void> {
  const paymentInstructions = state.bankTransfers ? JSON.stringify(state.bankTransfers) : null;
  await db.execute(sql`
    update skypadi_whatsapp.bookings
    set
      supplier_booking_state = supplier_booking_state || ${JSON.stringify(state)}::jsonb,
      supplier_payment_instructions = coalesce(${paymentInstructions}::jsonb, supplier_payment_instructions),
      updated_at = now()
    where id = ${bookingId}
  `);
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
