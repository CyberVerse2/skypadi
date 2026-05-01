import assert from "node:assert/strict";

import { rankFlightOptionsForDisplay } from "../../src/domain/flight/flight-search.service";
import { presentStoredFlightOptions, rankedFlightOptionsToListIntent } from "../../src/workflows/flight-search.workflow";
import { flightOptionReplyId } from "../../src/channels/whatsapp/whatsapp.reply-ids";
import type { DisplayFlightOption } from "../../src/domain/flight/flight.types";

const ranked = rankFlightOptionsForDisplay([
  option({ id: "a", airline: "Air Peace", departureTime: "06:45", arrivalTime: "08:05", price: 171000 }),
  option({ id: "b", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
  option({ id: "c", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:50", price: 158000 }),
]);

assert.equal(ranked.cheapest.id, "b");
assert.equal(ranked.fastest.id, "c");
assert.equal(ranked.bestValue.id, "c");
assert.equal(ranked.evening.id, "b");

const lowStressRanked = rankFlightOptionsForDisplay([
  option({ id: "morning", airline: "Budget", departureTime: "09:05", arrivalTime: "10:15", price: 150000 }),
  option({ id: "afternoon", airline: "Ibom Air", departureTime: "13:15", arrivalTime: "14:30", price: 154000 }),
]);

assert.equal(lowStressRanked.bestValue.id, "afternoon");
assert.throws(() => rankFlightOptionsForDisplay([]), /At least one flight option is required/);

const distinctAirlineList = rankedFlightOptionsToListIntent(
  rankFlightOptionsForDisplay([
    option({ id: "value-early", airline: "ValueJet", departureTime: "07:30", arrivalTime: "08:40", price: 142000 }),
    option({ id: "value-late", airline: "ValueJet", departureTime: "10:30", arrivalTime: "11:45", price: 139000 }),
    option({ id: "ibom-afternoon", airline: "Ibom Air", departureTime: "13:45", arrivalTime: "14:55", price: 158000 }),
    option({ id: "air-peace-fast", airline: "Air Peace", departureTime: "06:45", arrivalTime: "07:45", price: 171000 }),
    option({ id: "green-evening", airline: "Green Africa", departureTime: "19:15", arrivalTime: "20:25", price: 160000 }),
  ])
);

assert.deepEqual(
  distinctAirlineList.rows.map((row) => row.id),
  [
    flightOptionReplyId("value-late"),
    flightOptionReplyId("ibom-afternoon"),
    flightOptionReplyId("air-peace-fast"),
    flightOptionReplyId("green-evening"),
  ]
);
assert.equal(distinctAirlineList.rows.length, 4);
assert.deepEqual(
  distinctAirlineList.rows.map((row) => row.title),
  ["1 Cheapest: ValueJet", "2 Best: Ibom Air", "3 Fastest: Air Peace", "4 Evening: Green Africa"]
);
assert.deepEqual(
  distinctAirlineList.rows.map((row) => row.description),
  [
    "10:30-11:45 - NGN 139,000",
    "13:45-14:55 - NGN 158,000",
    "06:45-07:45 - NGN 171,000",
    "19:15-20:25 - NGN 160,000",
  ]
);
assert.match(distinctAirlineList.body, /I found 4 good options/);
assert.match(distinctAirlineList.body, /Cheapest — ValueJet/);
assert.match(distinctAirlineList.body, /Best Value — Ibom Air/);
assert.match(distinctAirlineList.body, /Fastest — Air Peace/);
assert.match(distinctAirlineList.body, /Evening — Green Africa/);
assert.match(distinctAirlineList.body, /My recommendation: Ibom Air/);
assert.match(distinctAirlineList.body, /cheapest afternoon/i);

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
  assert.equal(presented.value.cheapest.durationMinutes, 70);
}
console.log("flight ranking tests passed");

function option(input: {
  id: string;
  airline: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
}): DisplayFlightOption {
  return {
    ...input,
    durationMinutes: minutes(input.arrivalTime) - minutes(input.departureTime),
    stops: 0,
  };
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}
