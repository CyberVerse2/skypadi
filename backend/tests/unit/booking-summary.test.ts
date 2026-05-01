import assert from "node:assert/strict";

import { bookingSummaryPassengerFlowBody } from "../../src/workflows/booking-summary";

const body = bookingSummaryPassengerFlowBody({
  passengerPrompt: "I need the passenger details to continue.",
  summary: {
    route: "Lagos → Abuja",
    flight: "Ibom Air, 8:45 AM tomorrow",
    baggage: "standard cabin + checked baggage included",
    fare: 158000,
    currency: "NGN",
    skypadiFee: 3000,
  },
});

assert.match(body, /^Great\. Here’s your booking summary:/);
assert.match(body, /Route: Lagos → Abuja/);
assert.match(body, /Flight: Ibom Air, 8:45 AM tomorrow/);
assert.match(body, /Fare: ₦158,000/);
assert.match(body, /Skypadi fee: ₦3,000/);
assert.match(body, /Total: ₦161,000/);
assert.match(body, /I need the passenger details to continue\.$/);

console.log("booking summary tests passed");
