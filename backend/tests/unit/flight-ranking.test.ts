import assert from "node:assert/strict";

import { rankFlightOptionsForDisplay } from "../../src/domain/flight/flight-search.service";
import { presentStoredFlightOptions, rankedFlightOptionsToIntent } from "../../src/workflows/flight-search.workflow";
import { flightOptionReplyId } from "../../src/workflows/flight-option-reply-ids";
import type { DisplayFlightOption } from "../../src/domain/flight/flight.types";
import { test } from "vitest";

test("flight ranking", async () => {
  const ranked = rankFlightOptionsForDisplay([
    option({ id: "a", airline: "Air Peace", departureTime: "06:45", arrivalTime: "08:05", price: 171000 }),
    option({ id: "b", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
    option({ id: "c", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:50", price: 158000 }),
  ]);

  assert.equal(ranked.cheapest.id, "b");
  assert.equal(ranked.fastest.id, "c");
  assert.equal(ranked.morning.id, "b");
  assert.equal(ranked.afternoon.id, "c");
  assert.equal(ranked.bestValue.id, "b");
  assert.equal(ranked.evening.id, "b");

  const lowStressRanked = rankFlightOptionsForDisplay([
    option({ id: "morning", airline: "Budget", departureTime: "06:05", arrivalTime: "07:15", price: 150000 }),
    option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:15", arrivalTime: "14:30", price: 154000 }),
  ]);

  assert.equal(lowStressRanked.bestValue.id, "afternoon");

  const sensibleMorningRanked = rankFlightOptionsForDisplay([
    option({ id: "ten-am", airline: "Aero", departureTime: "10:00", arrivalTime: "11:10", price: 150000 }),
    option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:15", arrivalTime: "14:30", price: 154000 }),
  ]);

  assert.equal(sensibleMorningRanked.bestValue.id, "ten-am");

  const overpricedAfternoonRanked = rankFlightOptionsForDisplay([
    option({ id: "near-noon", airline: "ValueJet", departureTime: "11:45", arrivalTime: "12:55", price: 142000 }),
    option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:10", arrivalTime: "14:10", price: 162000 }),
  ]);

  assert.equal(overpricedAfternoonRanked.bestValue.id, "near-noon");
  assert.throws(() => rankFlightOptionsForDisplay([]), /At least one flight option is required/);

  const distinctAirlineList = rankedFlightOptionsToIntent(
    rankFlightOptionsForDisplay([
      option({ id: "value-early", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
      option({ id: "value-late", airline: "ValueJet", departureTime: "10:30", arrivalTime: "11:45", price: 139000 }),
      option({ id: "ibom-afternoon", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:55", price: 158000 }),
      option({ id: "air-peace-fast", airline: "Air Peace", departureTime: "06:45", arrivalTime: "07:45", price: 171000 }),
      option({ id: "green-evening", airline: "Green Africa", departureTime: "19:15", arrivalTime: "20:25", price: 160000 }),
    ])
  );

  assert.equal(distinctAirlineList.type, "flight_list");
  assert.equal(distinctAirlineList.buttonText, "Choose flight");
  assert.deepEqual(
    distinctAirlineList.rows.map((row) => row.id),
    [
      flightOptionReplyId("value-late"),
      flightOptionReplyId("ibom-afternoon"),
      flightOptionReplyId("green-evening"),
      flightOptionReplyId("air-peace-fast"),
    ]
  );
  assert.equal(distinctAirlineList.rows.length, 4);
  assert.deepEqual(
    distinctAirlineList.rows.map((row) => row.title),
    ["1 Morning: ValueJet", "2 Afternoon: Ibom Air", "3 Evening: Green Africa", "4 Fastest: Air Peace"]
  );
  assert.deepEqual(
    distinctAirlineList.rows.map((row) => row.description),
    [
      "10:30-11:45 - NGN 139,000 - Direct",
      "13:45-14:55 - NGN 158,000 - Direct",
      "19:15-20:25 - NGN 160,000 - Direct",
      "06:45-07:45 - NGN 171,000 - Direct",
    ]
  );
  assert.match(distinctAirlineList.body, /I found 4 good options/);
  assert.match(distinctAirlineList.body, /Morning — ValueJet/);
  assert.match(distinctAirlineList.body, /Afternoon — Ibom Air/);
  assert.match(distinctAirlineList.body, /Fastest — Air Peace/);
  assert.match(distinctAirlineList.body, /Evening — Green Africa/);
  assert.match(distinctAirlineList.body, /My recommendation: ValueJet/);
  assert.match(distinctAirlineList.body, /already a good morning time/i);

  const morningButtons = rankedFlightOptionsToIntent(
    rankFlightOptionsForDisplay([
      option({ id: "cheap-evening", airline: "Arik Air", departureTime: "17:50", arrivalTime: "19:05", price: 104405 }),
      option({ id: "best-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
      option({ id: "later-morning", airline: "Air Peace", departureTime: "11:20", arrivalTime: "12:40", price: 136678 }),
    ]),
    "morning"
  );

  assert.equal(morningButtons.type, "reply_buttons");
  assert.deepEqual(morningButtons.buttons, [
    {
      id: flightOptionReplyId("best-morning"),
      title: "Book this",
    },
    {
      id: flightOptionReplyId("cheap-evening"),
      title: "Best value overall",
    },
  ]);
  assert.match(morningButtons.body, /Best Morning — Aero/);
  assert.match(morningButtons.body, /best-value morning option/i);
  assert.doesNotMatch(morningButtons.body, /cheapest/i);
  assert.match(morningButtons.body, /save ₦1,881/i);
  assert.match(morningButtons.body, /travel at evening/i);

  const eveningButtons = rankedFlightOptionsToIntent(
    rankFlightOptionsForDisplay([
      option({ id: "cheap-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
      option({ id: "best-evening", airline: "United Nigeria", departureTime: "18:55", arrivalTime: "20:10", price: 130050 }),
    ]),
    "evening"
  );

  assert.equal(eveningButtons.type, "reply_buttons");
  assert.equal(eveningButtons.buttons[0]?.id, flightOptionReplyId("best-evening"));
  assert.equal(eveningButtons.buttons[0]?.title, "Book this");
  assert.equal(eveningButtons.buttons[1]?.id, flightOptionReplyId("cheap-morning"));
  assert.equal(eveningButtons.buttons[1]?.title, "Best value overall");
  assert.match(eveningButtons.body, /Best Evening — United Nigeria/);
  assert.doesNotMatch(eveningButtons.body, /cheapest/i);
  assert.match(eveningButtons.body, /save ₦23,764/i);

  const cheapestMorningCta = rankedFlightOptionsToIntent(
    rankFlightOptionsForDisplay([
      option({ id: "best-morning", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
      option({ id: "later-morning", airline: "Air Peace", departureTime: "11:20", arrivalTime: "12:40", price: 136678 }),
    ]),
    "morning"
  );

  assert.equal(cheapestMorningCta.type, "cta_button");
  assert.equal(cheapestMorningCta.button.id, flightOptionReplyId("best-morning"));
  assert.equal(cheapestMorningCta.button.title, "Book this");
  assert.match(cheapestMorningCta.body, /Best Morning — Aero/);
  assert.match(cheapestMorningCta.body, /best value overall/i);
  assert.doesNotMatch(cheapestMorningCta.body, /cheapest/i);

  const directPreferred = rankFlightOptionsForDisplay([
    option({ id: "cheap-stop", airline: "Air Peace", departureTime: "14:25", arrivalTime: "09:50", price: 100000, stops: 1 }),
    option({ id: "direct", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
  ]);

  assert.equal(directPreferred.cheapest.id, "direct");
  assert.equal(directPreferred.options.some((flight) => flight.id === "cheap-stop"), false);

  const deduped = rankFlightOptionsForDisplay([
    option({ id: "expensive-duplicate", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 120000 }),
    option({ id: "cheap-duplicate", airline: "Aero", departureTime: "10:20", arrivalTime: "11:35", price: 106286 }),
  ]);

  assert.equal(deduped.cheapest.id, "cheap-duplicate");
  assert.equal(deduped.options.length, 1);

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

  assert.equal(presented.kind, "ok");
  if (presented.kind === "ok") {
    assert.equal(presented.value.cheapest.departureTime, "08:45");
    assert.equal(presented.value.cheapest.arrivalTime, "09:55");
    assert.equal(presented.value.cheapest.durationMinutes, 65);
  }
  console.log("flight ranking tests passed");

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
});
