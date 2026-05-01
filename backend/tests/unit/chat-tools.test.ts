import assert from "node:assert/strict";

import { executeSearchFlightsTool } from "../../src/tools/search-flights.tool";
import { executeStartBookingJobTool } from "../../src/tools/start-booking-job.tool";

const searchIntent = await executeSearchFlightsTool({
  userId: "user-1",
  conversationId: "conversation-1",
  phoneNumber: "2348012345678",
  input: {
    origin: "LOS",
    destination: "ENU",
    departureDate: "2026-05-09",
    adults: 1,
  },
  flightSearchHandler: {
    async searchAndPresent(input) {
      assert.deepEqual(input, {
        userId: "user-1",
        conversationId: "conversation-1",
        phoneNumber: "2348012345678",
        search: {
          origin: "LOS",
          destination: "ENU",
          departureDate: "2026-05-09",
          departureWindow: "anytime",
          tripType: "one_way",
          returnDate: undefined,
          adults: 1,
        },
      });
      return {
        type: "text",
        body: "Found flights to Enugu.",
      };
    },
  },
});

assert.deepEqual(searchIntent, {
  type: "text",
  body: "Found flights to Enugu.",
});

const bookingIntent = await executeStartBookingJobTool({
  conversationId: "conversation-1",
  userId: "user-1",
  phoneNumber: "2348012345678",
  input: {
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
  createBookingFromSelectedOption: async (input) => {
    assert.deepEqual(input, {
      userId: "user-1",
      conversationId: "conversation-1",
      selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
      inboundDomain: "booking.local",
    });

    return {
      kind: "ok",
      value: {
        id: "booking-1",
        userId: "user-1",
        conversationId: "conversation-1",
        selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
        status: "priced",
        bookingEmailAlias: "book-abc@example.com",
        createdAt: new Date("2026-05-01T09:00:00.000Z"),
      },
    };
  },
  passengerDetailsFlowId: "flow-1",
});

assert.deepEqual(bookingIntent, {
  type: "passenger_details_flow",
  body: "Great choice. Please enter the passenger details.",
  buttonText: "Enter details",
  flowId: "flow-1",
  flowToken: "booking-1",
  data: {
    bookingId: "booking-1",
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
});

console.log("chat tool tests passed");
