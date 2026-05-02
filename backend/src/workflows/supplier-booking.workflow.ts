import type { BookingStatus } from "../domain/booking/booking.types";
import type { DbClient } from "../db/client";
import type { SupplierBookingPolicy, SupplierHoldResult } from "../integrations/wakanow/wakanow.types";
import type { BankTransferDetails } from "../schemas/booking-contract";
import { sql, type SQL } from "drizzle-orm";

export type SupplierHoldWorkflowInput = {
  bookingId: string;
  result: SupplierHoldResult;
};

export type SupplierHoldDecision = {
  bookingId: string;
  status: BookingStatus;
  policy: SupplierBookingPolicy;
  supplier: "wakanow";
  supplierBookingRef?: string;
  holdExpiresAt?: Date;
  amountDue?: number;
  currency?: "NGN";
  paymentUrl?: string;
  bankTransfers?: BankTransferDetails[];
  holdMode: SupplierHoldResult["kind"];
  reason?: string;
  rawStatus: string;
};

export type SupplierBookingRepository = {
  applySupplierDecision(input: {
    bookingId: string;
    status: BookingStatus;
    supplier: "wakanow";
    supplierBookingRef?: string;
    holdExpiresAt?: Date;
    amountDue?: number;
    currency?: "NGN";
    supplierPaymentInstructions?: BankTransferDetails[];
    failureReason?: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    observedAt: Date;
  }): Promise<void>;
};

export type SupplierEventRepository = {
  recordSupplierEvent(input: {
    bookingId: string;
    supplier: "wakanow";
    eventType: string;
    payload: Record<string, unknown>;
    observedAt: Date;
  }): Promise<void>;
};

export function createDrizzleSupplierBookingRepository(db: DbClient): SupplierBookingRepository {
  return {
    async applySupplierDecision(input) {
      const result = await db.execute(sql`
        with updated_booking as (
          update skypadi_whatsapp.bookings
          set
            status = ${input.status},
            supplier = ${input.supplier},
            supplier_booking_reference = ${input.supplierBookingRef ?? null},
            supplier_hold_expires_at = ${input.holdExpiresAt ?? null},
            amount = ${input.amountDue ?? null},
            currency = coalesce(${input.currency ?? null}, currency),
            supplier_payment_instructions = coalesce(${input.supplierPaymentInstructions ? jsonb(input.supplierPaymentInstructions) : null}, supplier_payment_instructions),
            failure_reason = ${input.failureReason ?? null},
            updated_at = ${input.observedAt}
          where id = ${input.bookingId}
          returning id
        )
        insert into skypadi_whatsapp.supplier_events (
          booking_id,
          supplier,
          event_type,
          supplier_reference,
          payload,
          observed_at
        )
        select
          updated_booking.id,
          ${input.supplier},
          ${input.eventType},
          ${input.supplierBookingRef ?? null},
          ${jsonb(input.eventPayload)},
          ${input.observedAt}
        from updated_booking
        returning booking_id
      `);
      const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
      if (rowCount === 0) {
        throw new Error("Supplier decision could not be applied to booking");
      }
    },
  };
}

export function handleSupplierHoldResult(input: SupplierHoldWorkflowInput): SupplierHoldDecision {
  const base = {
    bookingId: input.bookingId,
    supplier: input.result.supplier,
    holdMode: input.result.kind,
    rawStatus: input.result.rawStatus,
  };

  switch (input.result.kind) {
    case "hold_created":
      return {
        ...base,
        status: "awaiting_payment_for_hold",
        policy: "hold_first",
        supplierBookingRef: input.result.supplierBookingRef,
        holdExpiresAt: input.result.expiresAt,
        amountDue: input.result.amountDue,
        currency: input.result.currency,
        paymentUrl: input.result.paymentUrl,
        bankTransfers: input.result.bankTransfers,
      };
    case "instant_purchase_required":
    case "hold_unavailable":
      return {
        ...base,
        status: "payment_pending",
        policy: "payment_first",
        amountDue: input.result.amountDue,
        currency: input.result.currency,
        reason: input.result.reason,
      };
    case "unclear":
      return {
        ...base,
        status: "manual_review_required",
        policy: "manual_review",
        reason: input.result.reason,
      };
  }
}

export async function recordSupplierHoldDecision(input: {
  decision: SupplierHoldDecision;
  repository: SupplierBookingRepository;
  observedAt?: Date;
}): Promise<SupplierHoldDecision> {
  const eventType = `supplier_hold.${input.decision.holdMode}`;
  await input.repository.applySupplierDecision({
    bookingId: input.decision.bookingId,
    status: input.decision.status,
    supplier: input.decision.supplier,
    supplierBookingRef: input.decision.supplierBookingRef,
    holdExpiresAt: input.decision.holdExpiresAt,
    amountDue: input.decision.amountDue,
    currency: input.decision.currency,
    supplierPaymentInstructions: input.decision.bankTransfers,
    failureReason: input.decision.reason,
    eventType,
    eventPayload: sanitizeSupplierDecision(input.decision),
    observedAt: input.observedAt ?? new Date(),
  });

  return input.decision;
}

export async function recordSupplierEventOnly(input: {
  decision: SupplierHoldDecision;
  repository: SupplierEventRepository;
  observedAt?: Date;
}): Promise<SupplierHoldDecision> {
  await input.repository.recordSupplierEvent({
    bookingId: input.decision.bookingId,
    supplier: input.decision.supplier,
    eventType: `supplier_hold.${input.decision.holdMode}`,
    payload: sanitizeSupplierDecision(input.decision),
    observedAt: input.observedAt ?? new Date(),
  });

  return input.decision;
}

function sanitizeSupplierDecision(decision: SupplierHoldDecision): Record<string, unknown> {
  return {
    status: decision.status,
    policy: decision.policy,
    holdMode: decision.holdMode,
    supplierBookingRef: decision.supplierBookingRef,
    holdExpiresAt: decision.holdExpiresAt?.toISOString(),
    amountDue: decision.amountDue,
    currency: decision.currency,
    paymentUrl: decision.paymentUrl,
    bankTransfers: decision.bankTransfers,
    reason: decision.reason,
    rawStatus: decision.rawStatus,
  };
}

function jsonb(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}
