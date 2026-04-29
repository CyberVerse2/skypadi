import { sql, type SQL } from "drizzle-orm";

import type { BookingStatus } from "../booking/booking.types.js";
import type { DbClient } from "../../db/client.js";
import type { PaymentAttempt, PaymentStatus } from "./payment.types.js";

export type CreatePaymentAttemptRecord = {
  id: string;
  bookingId: string;
  method: "transfer" | "card";
  amount: number;
  currency: "NGN";
  providerReference?: string;
  createdAt: Date;
};

export type PaymentConfirmationRecord = {
  bookingId: string;
  paymentAttemptId: string;
  confirmedBy: string;
  confirmedAt: Date;
  providerReference: string;
  paidAmount: number;
  currency: "NGN";
};

export type PaymentRepository = {
  createPaymentAttempt(input: CreatePaymentAttemptRecord): Promise<PaymentAttempt>;
  markPaidClaimed(input: { bookingId: string; paymentAttemptId: string; claimedAt: Date }): Promise<void>;
  confirmPayment(input: PaymentConfirmationRecord): Promise<void>;
};

export function createDrizzlePaymentRepository(db: DbClient): PaymentRepository {
  return {
    async createPaymentAttempt(input) {
      await db.execute(sql`
        with inserted_attempt as (
          insert into skypadi_whatsapp.payment_attempts (
            id,
            booking_id,
            method,
            provider,
            provider_reference,
            status,
            amount,
            currency,
            created_at,
            updated_at
          )
          values (
            ${input.id},
            ${input.bookingId},
            ${input.method},
            'skypadi',
            ${input.providerReference},
            'pending',
            ${input.amount},
            ${input.currency},
            ${input.createdAt},
            ${input.createdAt}
          )
          returning id
        )
        update skypadi_whatsapp.bookings
        set status = 'payment_pending', updated_at = ${input.createdAt}
        where id = ${input.bookingId}
      `);

      return toPaymentAttempt(input, "pending");
    },
    async markPaidClaimed(input) {
      const result = await db.execute(sql`
        update skypadi_whatsapp.payment_attempts
        set status = 'proof_uploaded', updated_at = ${input.claimedAt}
        where id = ${input.paymentAttemptId}
          and booking_id = ${input.bookingId}
          and status = 'pending'
        returning id
      `);
      const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;

      if (rowCount === 0) {
        throw new Error("Payment attempt was not eligible for paid claim");
      }
    },
    async confirmPayment(input) {
      const result = await db.execute(sql`
        with confirmed_attempt as (
          update skypadi_whatsapp.payment_attempts
          set
            status = 'confirmed',
            reviewed_by = ${input.confirmedBy},
            reviewed_at = ${input.confirmedAt},
            provider_reference = ${input.providerReference},
            updated_at = ${input.confirmedAt}
          where id = ${input.paymentAttemptId}
            and booking_id = ${input.bookingId}
            and status in ('pending', 'proof_uploaded')
            and amount = ${input.paidAmount}
            and currency = ${input.currency}
          returning id
        ),
        updated_booking as (
          update skypadi_whatsapp.bookings
          set status = 'payment_confirmed', updated_at = ${input.confirmedAt}
          where id = ${input.bookingId}
            and exists (select 1 from confirmed_attempt)
            and status in ('payment_pending', 'awaiting_payment_for_hold')
            and (supplier_hold_expires_at is null or supplier_hold_expires_at > ${input.confirmedAt})
          returning id
        )
        insert into skypadi_whatsapp.audit_events (
          booking_id,
          payment_attempt_id,
          event_type,
          actor_type,
          actor_id,
          payload,
          created_at
        )
        select
          ${input.bookingId},
          ${input.paymentAttemptId},
          'payment.confirmed',
          'system',
          ${input.confirmedBy},
          ${jsonb({
            confirmedBy: input.confirmedBy,
            providerReference: input.providerReference,
            paidAmount: input.paidAmount,
            currency: input.currency,
          })},
          ${input.confirmedAt}
        where exists (select 1 from updated_booking)
        returning booking_id
      `);
      const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;

      if (rowCount === 0) {
        throw new Error("Payment attempt was not eligible for confirmation");
      }
    },
  };
}

export type PaymentWorkflowDecision = {
  bookingId: string;
  paymentAttemptId: string;
  method?: "transfer" | "card";
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
};

function toPaymentAttempt(input: CreatePaymentAttemptRecord, status: PaymentStatus): PaymentAttempt {
  return {
    id: input.id,
    bookingId: input.bookingId,
    method: input.method,
    status,
    amount: input.amount,
    currency: input.currency,
    providerReference: input.providerReference,
    createdAt: input.createdAt,
  };
}

function jsonb(value: Record<string, unknown>): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}
