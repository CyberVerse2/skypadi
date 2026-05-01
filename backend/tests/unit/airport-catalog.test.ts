import assert from "node:assert/strict";

import {
  airportByCode,
  nigerianOriginAirports,
  normalizeAirportCode,
  resolveAirport,
  wakanowAirports,
  whatsappOriginRows,
} from "../../src/domain/flight/airport-catalog";
import { test } from "vitest";

test("airport catalog", async () => {
  assert.ok(wakanowAirports.length > 10);
  assert.equal(whatsappOriginRows.length, 10);
  for (const id of ["origin:LOS", "origin:ABV", "origin:PHC", "origin:KAN", "origin:ENU"]) {
    assert.ok(whatsappOriginRows.some((row) => row.id === id), `${id} should be in origin rows`);
  }
  assert.ok(nigerianOriginAirports.length >= 10);
  assert.equal(airportByCode("ENU")?.city, "Enugu");
  assert.equal(airportByCode("PHC")?.city, "Port Harcourt");
  assert.equal(airportByCode("LAG")?.code, "LOS");
  assert.equal(normalizeAirportCode("lag"), "LOS");
  assert.equal(resolveAirport("lagos")?.code, "LOS");
  assert.equal(resolveAirport("Accra")?.code, "ACC");
  assert.equal(resolveAirport("Heathrow Airport")?.code, "LHR");
  assert.equal(airportByCode("xxx"), undefined);
  assert.equal(resolveAirport("xxx"), undefined);

  console.log("airport catalog tests passed");
});
