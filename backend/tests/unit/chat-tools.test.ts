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

const returnSearchIntent = await executeSearchFlightsTool({
  userId: "user-1",
  conversationId: "conversation-1",
  phoneNumber: "2348012345678",
  input: {
    origin: "LOS",
    destination: "DXB",
    departureDate: "2026-06-10",
    returnDate: "2026-06-17",
    adults: 2,
  },
  flightSearchHandler: {
    async searchAndPresent(input) {
      assert.equal(input.search.tripType, "return");
      assert.equal(input.search.returnDate, "2026-06-17");
      return {
        type: "text",
        body: "Found return flights to Dubai.",
      };
    },
  },
});

assert.deepEqual(returnSearchIntent, {
  type: "text",
  body: "Found return flights to Dubai.",
});

const failedSearchIntent = await executeSearchFlightsTool({
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
    async searchAndPresent() {
      throw new Error("supplier timeout");
    },
  },
});

assert.deepEqual(failedSearchIntent, {
  type: "text",
  body: "I could not search flights right now. Please try again shortly.",
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
      inboundDomain: "bookings.example.com",
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
  inboundDomain: "bookings.example.com",
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

let missingInboundDomainCalls = 0;
const missingInboundDomainIntent = await executeStartBookingJobTool({
  conversationId: "conversation-1",
  userId: "user-1",
  phoneNumber: "2348012345678",
  input: {
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
  createBookingFromSelectedOption: async () => {
    missingInboundDomainCalls += 1;
    throw new Error("should not be called");
  },
  passengerDetailsFlowId: "flow-1",
});

assert.equal(missingInboundDomainCalls, 0);
assert.deepEqual(missingInboundDomainIntent, {
  type: "text",
  body: "I could not start that booking yet. Please try again shortly.",
});

let blankInboundDomainCalls = 0;
const blankInboundDomainIntent = await executeStartBookingJobTool({
  conversationId: "conversation-1",
  userId: "user-1",
  phoneNumber: "2348012345678",
  input: {
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
  createBookingFromSelectedOption: async () => {
    blankInboundDomainCalls += 1;
    throw new Error("should not be called");
  },
  passengerDetailsFlowId: "flow-1",
  inboundDomain: "   ",
});

assert.equal(blankInboundDomainCalls, 0);
assert.deepEqual(blankInboundDomainIntent, {
  type: "text",
  body: "I could not start that booking yet. Please try again shortly.",
});

const failedBookingIntent = await executeStartBookingJobTool({
  conversationId: "conversation-1",
  userId: "user-1",
  phoneNumber: "2348012345678",
  input: {
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
  createBookingFromSelectedOption: async () => {
    throw new Error("database unavailable");
  },
  passengerDetailsFlowId: "flow-1",
  inboundDomain: "bookings.example.com",
});

assert.deepEqual(failedBookingIntent, {
  type: "text",
  body: "I could not start that booking. Please choose another flight.",
});

console.log("chat tool tests passed");
