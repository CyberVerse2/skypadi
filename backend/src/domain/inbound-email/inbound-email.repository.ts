import { sql, type SQL } from "drizzle-orm";

import type { DbClient } from "../../db/client.js";
import type {
  BookingEmailAliasRecord,
  InboundEmailClassification,
  InboundEmailRecord,
} from "./inbound-email.types.js";

export type SaveInboundEmailInput = {
  bookingId: string;
  bookingEmailAliasId: string;
  resendEmailId: string;
  messageId?: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: Date;
  classification: InboundEmailClassification;
  extractedOtp?: string;
  raw?: Record<string, unknown>;
};

export type InboundEmailRepository = {
  findActiveAliasByEmail(emailAddress: string): Promise<BookingEmailAliasRecord | undefined>;
  saveInboundEmail(input: SaveInboundEmailInput): Promise<InboundEmailRecord>;
  consumeOtp(input: { inboundEmailId: string; consumedAt: Date }): Promise<void>;
  recordSupplierEvent(input: {
    bookingId: string;
    inboundEmailId: string;
    supplier: "wakanow";
    eventType: string;
    payload: Record<string, unknown>;
    observedAt: Date;
  }): Promise<void>;
};

export function createDrizzleInboundEmailRepository(db: DbClient): InboundEmailRepository {
  return {
    async findActiveAliasByEmail(emailAddress) {
      const result = await db.execute(sql`
        select id, booking_id, email_address
        from skypadi_whatsapp.booking_email_aliases
        where email_address = ${emailAddress}
          and status = 'active'
        limit 1
      `);
      const row = result.rows[0] as { id: string; booking_id: string; email_address: string } | undefined;
      if (!row?.booking_id) return undefined;
      return { id: row.id, bookingId: row.booking_id, emailAddress: row.email_address };
    },
    async saveInboundEmail(input) {
      const result = await db.execute(sql`
        insert into skypadi_whatsapp.inbound_emails (
          booking_id,
          booking_email_alias_id,
          resend_email_id,
          message_id,
          from_email,
          to_emails,
          subject,
          text_body,
          html_body,
          received_at,
          classification,
          extracted_otp,
          processed_at,
          raw
        )
        values (
          ${input.bookingId},
          ${input.bookingEmailAliasId},
          ${input.resendEmailId},
          ${input.messageId},
          ${input.from},
          ${input.to},
          ${input.subject},
          ${input.text},
          ${input.html},
          ${input.receivedAt},
          ${input.classification},
          ${input.extractedOtp},
          now(),
          ${jsonb(input.raw ?? {})}
        )
        on conflict (resend_email_id) do update
          set processed_at = excluded.processed_at
        returning id, (xmax = 0) as was_created
      `);
      const row = result.rows[0] as { id: string; was_created: boolean };
      return { id: row.id, wasCreated: row.was_created };
    },
    async consumeOtp(input) {
      await db.execute(sql`
        update skypadi_whatsapp.inbound_emails
        set extracted_otp = null, otp_consumed_at = ${input.consumedAt}
        where id = ${input.inboundEmailId}
          and extracted_otp is not null
      `);
    },
    async recordSupplierEvent(input) {
      await db.execute(sql`
        insert into skypadi_whatsapp.supplier_events (
          booking_id,
          inbound_email_id,
          supplier,
          event_type,
          payload,
          observed_at
        )
        values (
          ${input.bookingId},
          ${input.inboundEmailId},
          ${input.supplier},
          ${input.eventType},
          ${jsonb(input.payload)},
          ${input.observedAt}
        )
      `);
    },
  };
}

function jsonb(value: Record<string, unknown>): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}
