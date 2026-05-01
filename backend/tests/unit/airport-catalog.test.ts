import assert from "node:assert/strict";

import { airportByCode, whatsappOriginRows } from "../../src/domain/flight/airport-catalog";

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
assert.equal(airportByCode("xxx"), undefined);

console.log("airport catalog tests passed");
