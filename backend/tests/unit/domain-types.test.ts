import assert from "node:assert/strict";

import { isTerminalBookingStatus } from "../../src/domain/booking/booking.types.js";
import { makeNeedsUserInput, makeOk } from "../../src/workflows/workflow-result.js";

assert.equal(isTerminalBookingStatus("issued"), true);
assert.equal(isTerminalBookingStatus("hold_expired"), true);
assert.equal(isTerminalBookingStatus("payment_pending"), false);

assert.deepEqual(makeOk({ message: "ready" }), {
  kind: "ok",
  value: { message: "ready" },
});

assert.deepEqual(makeNeedsUserInput("origin", { type: "origin_list" }), {
  kind: "needs_user_input",
  field: "origin",
  ui: { type: "origin_list" },
});

console.log("domain type tests passed");
