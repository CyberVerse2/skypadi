import { sql, type SQL } from "drizzle-orm";

import type { DbClient } from "../../db/client";
import type { InboundEmailRepository } from "./inbound-email.types";

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
    async findFirstActiveAliasByEmails(emailAddresses) {
      const candidates = emailAddresses.filter((emailAddress) => emailAddress.includes("@"));
      if (candidates.length === 0) return undefined;

      const result = await db.execute(sql`
        select id, booking_id, email_address
        from skypadi_whatsapp.booking_email_aliases
        where email_address = any(${candidates})
          and status = 'active'
        order by array_position(${candidates}, email_address)
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
          ${input.messageId ?? null},
          ${input.from},
          ${input.to},
          ${input.subject},
          ${input.text ?? null},
          ${input.html ?? null},
          ${input.receivedAt},
          ${input.classification},
          ${input.extractedOtp ?? null},
          now(),
          ${jsonb(input.raw ?? {})}
        )
        on conflict (resend_email_id) do nothing
        returning id
      `);
      const row = result.rows[0] as { id: string } | undefined;
      if (row) return { id: row.id, wasCreated: true };

      const existing = await db.execute(sql`
        select id
        from skypadi_whatsapp.inbound_emails
        where resend_email_id = ${input.resendEmailId}
        limit 1
      `);
      const existingRow = existing.rows[0] as { id: string } | undefined;
      if (!existingRow) {
        throw new Error("Inbound email conflict could not be resolved");
      }
      return { id: existingRow.id, wasCreated: false };
    },
    async claimNextUnconsumedOtp(input) {
      const result = await db.execute(sql`
        with next_otp as (
          select id
          from skypadi_whatsapp.inbound_emails
          where booking_id = ${input.bookingId}
            and classification = 'verification_code'
            and extracted_otp is not null
            and otp_consumed_at is null
            and (otp_claimed_at is null or otp_claimed_at < ${input.claimExpiresBefore})
          order by received_at asc
          limit 1
          for update skip locked
        )
        update skypadi_whatsapp.inbound_emails
        set otp_claimed_at = ${input.claimedAt}
        from next_otp
        where inbound_emails.id = next_otp.id
        returning inbound_emails.id, inbound_emails.extracted_otp
      `);
      const row = result.rows[0] as { id: string; extracted_otp: string | null } | undefined;
      if (!row?.extracted_otp) return undefined;
      return { inboundEmailId: row.id, otp: row.extracted_otp };
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
