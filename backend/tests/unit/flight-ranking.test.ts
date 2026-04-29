import assert from "node:assert/strict";

import { rankFlightOptionsForDisplay } from "../../src/domain/flight/flight-search.service.js";
import { presentStoredFlightOptions } from "../../src/workflows/flight-search.workflow.js";

const ranked = rankFlightOptionsForDisplay([
  { id: "a", airline: "Air Peace", departureTime: "06:45", price: 171000, stops: 0, baggageIncluded: true },
  { id: "b", airline: "ValueJet", departureTime: "07:30", price: 142000, stops: 0, baggageIncluded: false },
  { id: "c", airline: "Ibom Air", departureTime: "08:45", price: 158000, stops: 0, baggageIncluded: true },
]);

assert.equal(ranked.cheapest.id, "b");
assert.equal(ranked.earliest.id, "a");
assert.equal(ranked.bestValue.id, "c");

const lowStressRanked = rankFlightOptionsForDisplay([
  { id: "tiny-saving", airline: "Budget", departureTime: "06:05", price: 150000, stops: 1, baggageIncluded: false },
  { id: "calmer", airline: "Ibom Air", departureTime: "08:15", price: 154000, stops: 0, baggageIncluded: true },
]);

assert.equal(lowStressRanked.bestValue.id, "calmer");
assert.throws(() => rankFlightOptionsForDisplay([]), /At least one flight option is required/);

const presented = await presentStoredFlightOptions("search_123", {
  displayTimeZone: "Africa/Lagos",
  db: {
    execute: async () => ({
      rows: [
        {
          id: "lagos-time",
          airline_name: "Ibom Air",
          departure_at: "2026-06-10T07:45:00.000Z",
          amount: "158000",
          stops: 0,
          fare_rules: { baggageIncluded: true },
        },
      ],
    }),
  } as never,
});

assert.equal(presented.kind, "ok");
if (presented.kind === "ok") {
  assert.equal(presented.value.cheapest.departureTime, "08:45");
}
console.log("flight ranking tests passed");
