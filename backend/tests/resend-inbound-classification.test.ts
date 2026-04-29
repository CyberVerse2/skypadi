import assert from "node:assert/strict";

import { classifyInboundEmail } from "../src/workflows/inbound-email.workflow.js";

function email(overrides: { from?: string; subject?: string; text?: string }) {
  return {
    from: "Wakanow <noreply@wakanow.com>",
    subject: "Special travel offers this week",
    text: "Save on your next trip. No booking details are included.",
    ...overrides,
  };
}

assert.equal(
  classifyInboundEmail(email({})).classification,
  "other",
  "generic Wakanow emails should not be treated as booking confirmations"
);

const verification = classifyInboundEmail(
  email({
    subject: "Your Wakanow verification code",
    text: "Your verification code is 482913.",
  })
);
assert.equal(verification.classification, "verification_code");
assert.equal(verification.hasCode, true);
assert.equal("otp" in verification, false);

assert.equal(
  classifyInboundEmail(
    email({
      subject: "Booking confirmation: LOS to ABV",
      text: "Your itinerary is attached.",
    })
  ).classification,
  "booking_confirmation",
  "booking-related subjects should be treated as confirmations"
);

console.log("Resend inbound classification tests passed.");
