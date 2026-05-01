import assert from "node:assert/strict";

import { airportByCode, normalizeAirportCode, whatsappOriginRows } from "../../src/domain/flight/airport-catalog";
import { test } from "vitest";

test("airport catalog", async () => {
  assert.equal(whatsappOriginRows.length, 10);
  assert.deepEqual(whatsappOriginRows.map((row) => row.id), [
    "origin:LOS",
    "origin:ABV",
    "origin:PHC",
    "origin:KAN",
    "origin:ENU",
    "origin:QOW",
    "origin:ABB",
    "origin:BNI",
    "origin:QUO",
    "origin:QRW",
  ]);
  assert.equal(airportByCode("ENU")?.city, "Enugu");
  assert.equal(airportByCode("PHC")?.city, "Port Harcourt");
  assert.equal(airportByCode("LAG")?.code, "LOS");
  assert.equal(normalizeAirportCode("lag"), "LOS");
  assert.equal(airportByCode("xxx"), undefined);

  console.log("airport catalog tests passed");
});
