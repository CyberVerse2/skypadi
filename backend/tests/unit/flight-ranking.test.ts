
import { rankFlightOptionsForDisplay } from "../../src/domain/flight/flight-search.service";
import { presentStoredFlightOptions, rankedFlightOptionsToIntent } from "../../src/workflows/flight-search.workflow";
import { flightOptionReplyId } from "../../src/channels/whatsapp/whatsapp.reply-ids";
import type { DisplayFlightOption } from "../../src/domain/flight/flight.types";
import { describe, expect, test } from "vitest";


describe("unit flight ranking", () => {
  test("flight ranking", async () => {
    expect.hasAssertions();
    const ranked = rankFlightOptionsForDisplay([
      option({ id: "a", airline: "Air Peace", departureTime: "06:45", arrivalTime: "08:05", price: 171000 }),
      option({ id: "b", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
      option({ id: "c", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:50", price: 158000 }),
    ]);

    expect(ranked.cheapest.id).toBe("b");
    expect(ranked.fastest.id).toBe("c");
    expect(ranked.morning.id).toBe("b");
    expect(ranked.afternoon.id).toBe("c");
    expect(ranked.bestValue.id).toBe("b");
    expect(ranked.evening.id).toBe("b");

    const lowStressRanked = rankFlightOptionsForDisplay([
      option({ id: "morning", airline: "Budget", departureTime: "06:05", arrivalTime: "07:15", price: 150000 }),
      option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:15", arrivalTime: "14:30", price: 154000 }),
    ]);

    expect(lowStressRanked.bestValue.id).toBe("afternoon");

    const sensibleMorningRanked = rankFlightOptionsForDisplay([
      option({ id: "ten-am", airline: "Aero", departureTime: "10:00", arrivalTime: "11:10", price: 150000 }),
      option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:15", arrivalTime: "14:30", price: 154000 }),
    ]);

    expect(sensibleMorningRanked.bestValue.id).toBe("ten-am");

    const overpricedAfternoonRanked = rankFlightOptionsForDisplay([
      option({ id: "near-noon", airline: "ValueJet", departureTime: "11:45", arrivalTime: "12:55", price: 142000 }),
      option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:10", arrivalTime: "14:10", price: 162000 }),
    ]);

    expect(overpricedAfternoonRanked.bestValue.id).toBe("near-noon");
    expect(() => rankFlightOptionsForDisplay([])).toThrow(/At least one flight option is required/);

    const distinctAirlineList = rankedFlightOptionsToIntent(
      rankFlightOptionsForDisplay([
        option({ id: "value-early", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
        option({ id: "value-late", airline: "ValueJet", departureTime: "10:30", arrivalTime: "11:45", price: 139000 }),
        option({ id: "ibom-afternoon", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:55", price: 158000 }),
        option({ id: "air-peace-fast", airline: "Air Peace", departureTime: "06:45", arrivalTime: "07:45", price: 171000 }),
        option({ id: "green-evening", airline: "Green Africa", departureTime: "19:15", arrivalTime: "20:25", price: 160000 }),
      ])
    );

    assertIntentType(distinctAirlineList, "flight_list");
    expect(distinctAirlineList.buttonText).toBe("Choose flight");
    expect(distinctAirlineList.rows.map((row) => row.id)).toEqual([
        flightOptionReplyId("value-late"),
        flightOptionReplyId("ibom-afternoon"),
        flightOptionReplyId("green-evening"),
        flightOptionReplyId("air-peace-fast"),
      ]);
    expect(distinctAirlineList.rows.length).toBe(4);
    expect(distinctAirlineList.rows.map((row) => row.title)).toEqual(["1 Morning: ValueJet", "2 Afternoon: Ibom Air", "3 Evening: Green Africa", "4 Fastest: Air Peace"]);
    expect(distinctAirlineList.rows.map((row) => row.description)).toEqual([
        "10:30-11:45 - NGN 139,000 - Direct",
        "13:45-14:55 - NGN 158,000 - Direct",
        "19:15-20:25 - NGN 160,000 - Direct",
        "06:45-07:45 - NGN 171,000 - Direct",
      ]);
    expect(distinctAirlineList.body).toMatch(/I found 4 good options/);
    expect(distinctAirlineList.body).toMatch(/Morning — ValueJet/);
    expect(distinctAirlineList.body).toMatch(/Afternoon — Ibom Air/);
    expect(distinctAirlineList.body).toMatch(/Fastest — Air Peace/);
    expect(distinctAirlineList.body).toMatch(/Evening — Green Africa/);
    expect(distinctAirlineList.body).toMatch(/My recommendation: ValueJet/);
    expect(distinctAirlineList.body).toMatch(/already a good morning time/i);

    const morningButtons = rankedFlightOptionsToIntent(
      rankFlightOptionsForDisplay([
        option({ id: "cheap-evening", airline: "Arik Air", departureTime: "17:50", arrivalTime: "19:05", price: 104405 }),
        option({ id: "best-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
        option({ id: "later-morning", airline: "Air Peace", departureTime: "11:20", arrivalTime: "12:40", price: 136678 }),
      ]),
      "morning"
    );

    assertIntentType(morningButtons, "reply_buttons");
    expect(morningButtons.buttons).toEqual([
      {
        id: flightOptionReplyId("best-morning"),
        title: "Book this",
      },
      {
        id: flightOptionReplyId("cheap-evening"),
        title: "Best value overall",
      },
    ]);
    expect(morningButtons.body).toMatch(/Best Morning — Aero/);
    expect(morningButtons.body).toMatch(/best-value morning option/i);
    expect(morningButtons.body).not.toMatch(/cheapest/i);
    expect(morningButtons.body).toMatch(/save ₦1,881/i);
    expect(morningButtons.body).toMatch(/travel at evening/i);

    const eveningButtons = rankedFlightOptionsToIntent(
      rankFlightOptionsForDisplay([
        option({ id: "cheap-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
        option({ id: "best-evening", airline: "United Nigeria", departureTime: "18:55", arrivalTime: "20:10", price: 130050 }),
      ]),
      "evening"
    );

    assertIntentType(eveningButtons, "reply_buttons");
    expect(eveningButtons.buttons[0]?.id).toBe(flightOptionReplyId("best-evening"));
    expect(eveningButtons.buttons[0]?.title).toBe("Book this");
    expect(eveningButtons.buttons[1]?.id).toBe(flightOptionReplyId("cheap-morning"));
    expect(eveningButtons.buttons[1]?.title).toBe("Best value overall");
    expect(eveningButtons.body).toMatch(/Best Evening — United Nigeria/);
    expect(eveningButtons.body).not.toMatch(/cheapest/i);
    expect(eveningButtons.body).toMatch(/save ₦23,764/i);

    const cheapestMorningCta = rankedFlightOptionsToIntent(
      rankFlightOptionsForDisplay([
        option({ id: "best-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
        option({ id: "later-morning", airline: "Air Peace", departureTime: "11:20", arrivalTime: "12:40", price: 136678 }),
      ]),
      "morning"
    );

    assertIntentType(cheapestMorningCta, "cta_button");
    expect(cheapestMorningCta.button.id).toBe(flightOptionReplyId("best-morning"));
    expect(cheapestMorningCta.button.title).toBe("Book this");
    expect(cheapestMorningCta.body).toMatch(/Best Morning — Aero/);
    expect(cheapestMorningCta.body).toMatch(/best value overall/i);
    expect(cheapestMorningCta.body).not.toMatch(/cheapest/i);

    const directPreferred = rankFlightOptionsForDisplay([
      option({ id: "cheap-stop", airline: "Air Peace", departureTime: "14:25", arrivalTime: "09:50", price: 100000, stops: 1 }),
      option({ id: "direct", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
    ]);

    expect(directPreferred.cheapest.id).toBe("direct");
    expect(directPreferred.options.some((flight) => flight.id === "cheap-stop")).toBe(false);

    const deduped = rankFlightOptionsForDisplay([
      option({ id: "expensive-duplicate", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 120000 }),
      option({ id: "cheap-duplicate", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
    ]);

    expect(deduped.cheapest.id).toBe("cheap-duplicate");
    expect(deduped.options.length).toBe(1);

    const presented = await presentStoredFlightOptions("search_123", {
      displayTimeZone: "Africa/Lagos",
      db: {
        execute: async () => ({
          rows: [
            {
              id: "lagos-time",
              airline_name: "Ibom Air",
              departure_at: "2026-06-10T07:45:00.000Z",
              arrival_at: "2026-06-10T08:55:00.000Z",
              duration_minutes: 65,
              amount: "158000",
              stops: 0,
            },
          ],
        }),
      } as never,
    });

    expect(presented.kind).toBe("ok");
    if (presented.kind === "ok") {
      expect(presented.value.cheapest.departureTime).toBe("08:45");
      expect(presented.value.cheapest.arrivalTime).toBe("09:55");
      expect(presented.value.cheapest.durationMinutes).toBe(65);
    }

    function option(input: {
      id: string;
      airline: string;
      departureTime: string;
      arrivalTime: string;
      price: number;
      stops?: number;
    }): DisplayFlightOption {
      return {
        ...input,
        durationMinutes: minutes(input.arrivalTime) - minutes(input.departureTime),
        stops: input.stops ?? 0,
      };
    }

    function minutes(value: string): number {
      const [hours, mins] = value.split(":").map(Number);
      return hours * 60 + mins;
    }

    function assertIntentType<T extends { type: string }, K extends T["type"]>(
      intent: T,
      type: K,
    ): asserts intent is Extract<T, { type: K }> {
      expect(intent.type).toBe(type);
      if (intent.type !== type) {
        throw new Error(`Expected intent type ${type}, got ${intent.type}`);
      }
    }
  });
});
