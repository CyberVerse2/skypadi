import { sql } from "drizzle-orm";

import type { DbClient } from "../../db/client";
import { createDrizzleBookingRepository } from "../../domain/booking/booking.repository";
import { createDrizzleSupplierBookingJobRepository } from "../../jobs/booking-job.repository";
import { enqueueSupplierBookingJob, type SupplierBookingEnqueue } from "../../jobs/booking-queue";
import {
  collectDefaultPassengerAndQueueSupplierBooking,
  collectPassengerDetailsAndQueueSupplierBooking,
  createBookingFromSelectedOption,
} from "../../workflows/booking.workflow";
import { bookingSummaryPassengerFlowBody, type BookingSummaryDetails } from "../../workflows/booking-summary";
import type { UiIntent } from "./whatsapp.types";
import type { BookingSelectionHandler } from "./whatsapp.handlers";
import { bookingConfirmReplyId, bookingReplyIds, passengerReplyIds } from "./whatsapp.reply-ids";

export type LiveBookingHandlerConfig = {
  db: DbClient;
  inboundDomain: string;
  passengerDetailsFlowId: string;
  displayTimeZone: string;
  enqueueSupplierBooking?: SupplierBookingEnqueue;
};

export function createLiveBookingHandler(config: LiveBookingHandlerConfig): BookingSelectionHandler {
  const repository = createDrizzleBookingRepository(config.db);
  const jobRepository = createDrizzleSupplierBookingJobRepository(config.db);
  const enqueueSupplierBooking = config.enqueueSupplierBooking ?? enqueueSupplierBookingJob;

  return {
    async previewFlightSelection(input) {
      const summary = await findBookingSummaryForSelectedFlight({
        db: config.db,
        selectedFlightOptionId: input.selectedFlightOptionId,
        displayTimeZone: config.displayTimeZone,
      }).catch(() => undefined);

      return {
        type: "reply_buttons",
        body: summary
          ? bookingSummaryPassengerFlowBody({
              summary,
              passengerPrompt: "Continue booking this flight?",
            })
          : "Continue booking this flight?",
        buttons: [
          { id: bookingConfirmReplyId(input.selectedFlightOptionId), title: "Continue booking" },
          { id: bookingReplyIds.pickAnotherFlight, title: "Pick another" },
        ],
      };
    },
    async createFromFlightSelection(input) {
      const result = await createBookingFromSelectedOption({
        userId: input.userId,
        conversationId: input.conversationId,
        selectedFlightOptionId: input.selectedFlightOptionId,
        inboundDomain: config.inboundDomain,
        repository,
      });

      if (result.kind !== "ok") {
        return { type: "text", body: "I could not create that booking yet. Please try another flight." };
      }

      const summary = await findBookingSummaryForSelectedFlight({
        db: config.db,
        selectedFlightOptionId: result.value.selectedFlightOptionId,
        displayTimeZone: config.displayTimeZone,
      }).catch(() => undefined);
      const passenger = await repository.findDefaultPassengerForUser(input.userId);

      if (passenger) {
        const name = `${passenger.passenger.firstName} ${passenger.passenger.lastName}`;
        return {
          type: "reply_buttons",
          body: [
            summary
              ? bookingSummaryPassengerFlowBody({
                  summary,
                  passengerPrompt: `Continue booking for ${name}?`,
                })
              : `Continue booking for ${name}?`,
          ].join("\n"),
          buttons: [
            { id: passengerReplyIds.useDefault, title: `Use ${passenger.passenger.firstName}`.slice(0, 20) },
            { id: passengerReplyIds.different, title: "Different passenger" },
          ],
        };
      }

      return passengerDetailsFlowIntent({
        bookingId: result.value.id,
        selectedFlightOptionId: result.value.selectedFlightOptionId,
        body: summary
          ? bookingSummaryPassengerFlowBody({
              summary,
              passengerPrompt: "I need the passenger details to continue.",
            })
          : "Great choice. I need the passenger details to continue.",
        passengerDetailsFlowId: config.passengerDetailsFlowId,
      });
    },
    async collectPassengerDetails(input) {
      const result = await collectPassengerDetailsAndQueueSupplierBooking({
        userId: input.userId,
        conversationId: input.conversationId,
        passenger: input.passenger,
        repository,
        jobRepository,
        enqueueSupplierBooking,
      });

      if (result.kind === "needs_user_input") return result.ui;
      if (result.kind !== "ok") return undefined;

      return {
        type: "text",
        body: "Booking started. I’ll update you shortly.",
      };
    },
    async continueWithDefaultPassenger(input) {
      const result = await collectDefaultPassengerAndQueueSupplierBooking({
        userId: input.userId,
        conversationId: input.conversationId,
        repository,
        passengerRepository: repository,
        bookingPassengerRepository: repository,
        jobRepository,
        enqueueSupplierBooking,
      });

      if (result.kind === "needs_user_input") return result.ui;
      if (result.kind !== "ok") {
        return { type: "text", body: "I could not start that booking yet. Please enter passenger details again." };
      }

      return {
        type: "text",
        body: "Booking started. I’ll update you shortly.",
      };
    },
    async requestPassengerDetails(input) {
      const booking = await repository.findActiveBookingForPassengerCollection({
        userId: input.userId,
        conversationId: input.conversationId,
      });
      if (!booking) {
        return { type: "text", body: "I could not find an active booking to update. Please choose the flight again." };
      }

      return passengerDetailsFlowIntent({
        bookingId: booking.id,
        selectedFlightOptionId: booking.selectedFlightOptionId,
        body: "No problem. Enter the passenger details for this booking.",
        passengerDetailsFlowId: config.passengerDetailsFlowId,
      });
    },
  };
}

function passengerDetailsFlowIntent(input: {
  bookingId: string;
  selectedFlightOptionId: string;
  body: string;
  passengerDetailsFlowId: string;
}): UiIntent {
  return {
    type: "passenger_details_flow",
    body: input.body,
    buttonText: "Enter details",
    flowId: input.passengerDetailsFlowId,
    flowToken: input.bookingId,
    data: {
      bookingId: input.bookingId,
      selectedFlightOptionId: input.selectedFlightOptionId,
    },
  };
}

async function findBookingSummaryForSelectedFlight(input: {
  db: DbClient;
  selectedFlightOptionId: string;
  displayTimeZone: string;
}): Promise<BookingSummaryDetails | undefined> {
  const result = await input.db.execute(sql`
    select
      origin,
      destination,
      airline_name,
      departure_at,
      amount
    from skypadi_whatsapp.flight_options
    where id = ${input.selectedFlightOptionId}
    limit 1
  `);
  const row = result.rows[0] as
    | {
        origin: string;
        destination: string;
        airline_name: string | null;
        departure_at: Date | string;
        amount: string | number;
      }
    | undefined;
  if (!row) return undefined;

  return {
    route: `${row.origin} → ${row.destination}`,
    flight: `${row.airline_name ?? "Selected airline"}, ${formatFlightSummaryTime(row.departure_at, input.displayTimeZone)}`,
    baggage: "standard airline baggage rules apply",
    fare: Number(row.amount),
    currency: "NGN",
    skypadiFee: 3000,
  };
}

function formatFlightSummaryTime(value: Date | string, displayTimeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: displayTimeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
