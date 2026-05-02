
import { executeSearchFlightsTool } from "../../src/tools/search-flights.tool";
import { executeStartBookingJobTool } from "../../src/tools/start-booking-job.tool";
import { describe, expect, test } from "vitest";


describe("unit chat tools", () => {
  test("chat tools", async () => {
    const searchIntent = await executeSearchFlightsTool({
      userId: "user-1",
      conversationId: "conversation-1",
      phoneNumber: "2348012345678",
      input: {
        origin: "LOS",
        destination: "ENU",
        departureDate: "2026-05-09",
        departureWindow: "morning",
        adults: 1,
      },
      flightSearchHandler: {
        async searchAndPresent(input) {
          expect(input).toEqual({
            userId: "user-1",
            conversationId: "conversation-1",
            phoneNumber: "2348012345678",
            search: {
              origin: "LOS",
              destination: "ENU",
              departureDate: "2026-05-09",
              departureWindow: "morning",
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

    expect(searchIntent).toEqual({
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
          expect(input.search.tripType).toBe("return");
          expect(input.search.returnDate).toBe("2026-06-17");
          return {
            type: "text",
            body: "Found return flights to Dubai.",
          };
        },
      },
    });

    expect(returnSearchIntent).toEqual({
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

    expect(failedSearchIntent).toEqual({
      type: "text",
      body: "I could not search flights right now. Please try again shortly.",
    });

    const supplierError = new Error("supplier timeout");
    const failures: unknown[] = [];
    await executeSearchFlightsTool({
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
          throw supplierError;
        },
      },
      onFailure(error, context) {
        failures.push({ error, context });
      },
    });

    expect(failures).toEqual([
      {
        error: supplierError,
        context: {
          userId: "user-1",
          conversationId: "conversation-1",
          phoneNumber: "2348012345678",
          input: {
            origin: "LOS",
            destination: "ENU",
            departureDate: "2026-05-09",
            adults: 1,
          },
        },
      },
    ]);

    const bookingIntent = await executeStartBookingJobTool({
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
      input: {
        selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
      },
      createBookingFromSelectedOption: async (input) => {
        expect(input).toEqual({
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

    expect(bookingIntent).toEqual({
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

    expect(missingInboundDomainCalls).toBe(0);
    expect(missingInboundDomainIntent).toEqual({
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

    expect(blankInboundDomainCalls).toBe(0);
    expect(blankInboundDomainIntent).toEqual({
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

    expect(failedBookingIntent).toEqual({
      type: "text",
      body: "I could not start that booking. Please choose another flight.",
    });

    console.log("chat tool tests passed");
  });
});
