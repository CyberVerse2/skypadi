import { sql, type SQL } from "drizzle-orm";

import type { DbClient } from "../../db/client.js";
import type { BookingDraft, BookingStatus } from "./booking.types.js";

export type CreateBookingDraftRecord = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  status: BookingStatus;
  bookingEmailAlias: string;
  aliasLocalPart: string;
  aliasDomain: string;
  createdAt: Date;
};

export type BookingRepository = {
  createDraft(input: CreateBookingDraftRecord): Promise<BookingDraft>;
};

export function createDrizzleBookingRepository(db: DbClient): BookingRepository {
  return {
    async createDraft(input) {
      const result = await db.execute(sql`
        with selected_option as (
          select fo.id
          from skypadi_whatsapp.flight_options fo
          inner join skypadi_whatsapp.flight_searches fs on fs.id = fo.flight_search_id
          where fo.id = ${input.selectedFlightOptionId}
            and fs.user_id = ${input.userId}
            and fs.conversation_id = ${input.conversationId}
        ),
        inserted_booking as (
          insert into skypadi_whatsapp.bookings (
            id,
            user_id,
            conversation_id,
            selected_flight_option_id,
            status,
            created_at,
            updated_at
          )
          select
            ${input.id},
            ${input.userId},
            ${input.conversationId},
            selected_option.id,
            ${input.status},
            ${input.createdAt},
            ${input.createdAt}
          from selected_option
          returning id
        ),
        inserted_alias as (
          insert into skypadi_whatsapp.booking_email_aliases (
            booking_id,
            user_id,
            email_address,
            local_part,
            domain,
            status,
            created_at,
            updated_at
          )
          select
            inserted_booking.id,
            ${input.userId},
            ${input.bookingEmailAlias},
            ${input.aliasLocalPart},
            ${input.aliasDomain},
            'active',
            ${input.createdAt},
            ${input.createdAt}
          from inserted_booking
          returning id
        )
        insert into skypadi_whatsapp.audit_events (
          user_id,
          booking_id,
          event_type,
          actor_type,
          payload,
          created_at
        )
        select
          ${input.userId},
          inserted_booking.id,
          'booking.created',
          'system',
          ${jsonb({
            selectedFlightOptionId: input.selectedFlightOptionId,
            bookingEmailAlias: input.bookingEmailAlias,
          })},
          ${input.createdAt}
        from inserted_booking
        returning booking_id
      `);
      const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;

      if (rowCount === 0) {
        throw new Error("Selected flight option was not found for this user conversation");
      }

      return {
        id: input.id,
        userId: input.userId,
        conversationId: input.conversationId,
        selectedFlightOptionId: input.selectedFlightOptionId,
        status: input.status,
        bookingEmailAlias: input.bookingEmailAlias,
        createdAt: input.createdAt,
      };
    },
  };
}

function jsonb(value: Record<string, unknown>): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}
