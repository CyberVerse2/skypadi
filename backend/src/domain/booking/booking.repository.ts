import { sql, type SQL } from "drizzle-orm";

import type { DbClient } from "../../db/client";
import type { BookingRepository, BookingStatus } from "./booking.types";

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
      async findDefaultPassengerForUser(userId) {
        const result = await db.execute(sql`
          select
            id,
            title,
            first_name,
            middle_name,
            last_name,
            date_of_birth,
            gender,
            phone_number,
            email
          from skypadi_whatsapp.passengers
          where user_id = ${userId}
            and is_default = true
            and title is not null
            and date_of_birth is not null
            and gender is not null
            and phone_number is not null
            and email is not null
          order by updated_at desc
          limit 1
        `);
        const row = result.rows[0] as
          | {
              id: string;
              title: "Mr" | "Ms" | "Mrs" | "Miss" | "Sir" | "Dr";
              first_name: string;
              middle_name: string | null;
              last_name: string;
              date_of_birth: Date | string;
              gender: "Male" | "Female";
              phone_number: string;
              email: string;
            }
          | undefined;

        if (!row) return undefined;

        return {
          id: row.id,
          passenger: {
            title: row.title,
            firstName: row.first_name,
            middleName: row.middle_name ?? undefined,
            lastName: row.last_name,
            dateOfBirth: dateOnly(row.date_of_birth),
            nationality: "Nigerian",
            gender: row.gender,
            phone: row.phone_number,
            email: row.email,
          },
        };
      },
      async findActiveBookingForPassengerCollection(input) {
        const result = await db.execute(sql`
          select
            b.id,
            b.user_id,
            b.conversation_id,
            b.selected_flight_option_id,
            b.status,
            bea.email_address
          from skypadi_whatsapp.bookings b
          inner join skypadi_whatsapp.booking_email_aliases bea
            on bea.booking_id = b.id
            and bea.status = 'active'
          where b.user_id = ${input.userId}
            and b.conversation_id = ${input.conversationId}
            and b.status = 'priced'
          order by b.created_at desc
          limit 1
        `);
        const row = result.rows[0] as
          | {
              id: string;
              user_id: string;
              conversation_id: string;
              selected_flight_option_id: string;
              status: BookingStatus;
              email_address: string;
            }
          | undefined;

        if (!row) return undefined;

        return {
          id: row.id,
          userId: row.user_id,
          conversationId: row.conversation_id,
          selectedFlightOptionId: row.selected_flight_option_id,
          bookingEmailAlias: row.email_address,
          status: row.status,
        };
      },
      async collectPassengerDetails(input) {
        const result = await db.execute(sql`
          with inserted_passenger as (
            insert into skypadi_whatsapp.passengers (
              user_id,
              label,
              title,
              first_name,
              middle_name,
              last_name,
              date_of_birth,
              gender,
              phone_number,
              email,
              is_default,
              created_at,
              updated_at
            )
            values (
              ${input.userId},
              'Primary passenger',
              ${input.passenger.title},
              ${input.passenger.firstName},
              ${input.passenger.middleName ?? null},
              ${input.passenger.lastName},
              ${input.passenger.dateOfBirth},
              ${input.passenger.gender},
              ${input.passenger.phone},
              ${input.passenger.email},
              true,
              ${input.collectedAt},
              ${input.collectedAt}
            )
            returning id
          ),
          updated_booking as (
            update skypadi_whatsapp.bookings
            set
              status = 'supplier_booking_pending',
              customer_email = ${input.passenger.email},
              metadata = metadata || ${jsonb({
                supplierContactEmail: input.supplierContactEmail,
              })},
              updated_at = ${input.collectedAt}
            where id = ${input.bookingId}
              and user_id = ${input.userId}
              and conversation_id = ${input.conversationId}
              and status = 'priced'
            returning id
          ),
          inserted_booking_passenger as (
            insert into skypadi_whatsapp.booking_passengers (
              booking_id,
              passenger_id,
              passenger_type,
              snapshot,
              created_at,
              updated_at
            )
            select
              updated_booking.id,
              inserted_passenger.id,
              'adult',
              ${jsonb(input.passenger)},
              ${input.collectedAt},
              ${input.collectedAt}
            from updated_booking, inserted_passenger
            returning booking_id
          ),
          updated_conversation as (
            update skypadi_whatsapp.conversations
            set status = 'issuing_supplier_booking', updated_at = ${input.collectedAt}
            where id = ${input.conversationId}
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
            inserted_booking_passenger.booking_id,
            'booking.passenger_details_collected',
            'system',
            ${jsonb({
              passengerEmail: input.passenger.email,
              supplierContactEmail: input.supplierContactEmail,
            })},
            ${input.collectedAt}
          from inserted_booking_passenger
          returning booking_id
        `);
        const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
        if (rowCount === 0) {
          throw new Error("Passenger details could not be applied to the active booking");
        }
      },
      async collectSavedPassengerDetails(input) {
        const result = await db.execute(sql`
          with selected_passenger as (
            select id
            from skypadi_whatsapp.passengers
            where id = ${input.passengerId}
              and user_id = ${input.userId}
            limit 1
          ),
          updated_booking as (
            update skypadi_whatsapp.bookings
            set
              status = 'supplier_booking_pending',
              customer_email = ${input.passenger.email},
              metadata = metadata || ${jsonb({
                supplierContactEmail: input.supplierContactEmail,
              })},
              updated_at = ${input.collectedAt}
            where id = ${input.bookingId}
              and user_id = ${input.userId}
              and conversation_id = ${input.conversationId}
              and status = 'priced'
            returning id
          ),
          inserted_booking_passenger as (
            insert into skypadi_whatsapp.booking_passengers (
              booking_id,
              passenger_id,
              passenger_type,
              snapshot,
              created_at,
              updated_at
            )
            select
              updated_booking.id,
              selected_passenger.id,
              'adult',
              ${jsonb(input.passenger)},
              ${input.collectedAt},
              ${input.collectedAt}
            from updated_booking, selected_passenger
            returning booking_id
          ),
          updated_conversation as (
            update skypadi_whatsapp.conversations
            set status = 'issuing_supplier_booking', updated_at = ${input.collectedAt}
            where id = ${input.conversationId}
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
            inserted_booking_passenger.booking_id,
            'booking.saved_passenger_used',
            'system',
            ${jsonb({
              passengerId: input.passengerId,
              passengerEmail: input.passenger.email,
              supplierContactEmail: input.supplierContactEmail,
            })},
            ${input.collectedAt}
          from inserted_booking_passenger
          returning booking_id
        `);
        const rowCount = "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
        if (rowCount === 0) {
          throw new Error("Saved passenger details could not be applied to the active booking");
        }
      },
    };
  }

function jsonb(value: Record<string, unknown>): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function dateOnly(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
