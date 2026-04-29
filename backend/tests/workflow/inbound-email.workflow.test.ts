import assert from "node:assert/strict";

import {
  classifyInboundEmail,
  handleInboundEmail,
  handleInboundEmailForClassificationOnly,
  consumeInboundEmailOtp,
} from "../../src/workflows/inbound-email.workflow.js";

const classified = classifyInboundEmail({
  subject: "Your Wakanow verification code",
  text: "Use 493821 to complete your booking.",
  from: "noreply@wakanow.com",
});

assert.equal(classified.classification, "verification_code");
assert.equal(classified.hasCode, true);
assert.equal("otp" in classified, false);

const classificationOnly = handleInboundEmailForClassificationOnly({
  subject: "Your Wakanow verification code",
  text: "Use 493821 to complete your booking.",
  from: "noreply@wakanow.com",
});

assert.equal(classificationOnly.kind, "ok");

const supplierChange = classifyInboundEmail({
  subject: "Booking schedule change",
  text: "Your flight has changed.",
  from: "noreply@wakanow.com",
});
assert.equal(supplierChange.classification, "supplier_change");

const paymentReceipt = classifyInboundEmail({
  subject: "Payment confirmation receipt",
  text: "We received your transfer.",
  from: "noreply@wakanow.com",
});
assert.equal(paymentReceipt.classification, "payment_or_receipt");

let supplierEvents = 0;
const handled = await handleInboundEmail({
  resendEmailId: "email_123",
  to: ["ops@skypadi.test", "book_abc@bookings.wakanow.com"],
  from: "noreply@wakanow.com",
  subject: "Your Wakanow verification code",
  text: "Use 493821 to complete your booking.",
  receivedAt: new Date("2026-04-29T10:04:00.000Z"),
  repository: {
    async findActiveAliasByEmail(emailAddress) {
      if (emailAddress !== "book_abc@bookings.wakanow.com") return undefined;
      return { id: "alias_123", bookingId: "book_123", emailAddress };
    },
    async saveInboundEmail(input) {
      assert.equal(input.extractedOtp, "493821");
      return { id: "inbound_123", wasCreated: true };
    },
    async consumeOtp() {
      throw new Error("consume is not part of inbound handling");
    },
    async recordSupplierEvent(input) {
      supplierEvents += 1;
      assert.equal(input.eventType, "supplier_email.verification_code");
    },
  },
});

assert.equal(handled.kind, "ok");
if (handled.kind === "ok") {
  assert.equal(handled.value.classification, "verification_code");
  assert.equal(handled.value.hasCode, true);
  assert.equal("otp" in handled.value, false);
}
assert.equal(supplierEvents, 1);

const unknownAlias = await handleInboundEmail({
  resendEmailId: "email_124",
  to: "missing@bookings.wakanow.com",
  from: "noreply@wakanow.com",
  subject: "Ticket confirmed",
  text: "Your booking is confirmed.",
  receivedAt: new Date("2026-04-29T10:04:00.000Z"),
  repository: {
    async findActiveAliasByEmail() {
      return undefined;
    },
    async saveInboundEmail() {
      throw new Error("should not persist unknown aliases");
    },
    async consumeOtp() {
      throw new Error("should not consume unknown aliases");
    },
    async recordSupplierEvent() {
      throw new Error("should not record unknown aliases");
    },
  },
});

assert.equal(unknownAlias.kind, "needs_manual_review");

let consumedAt: Date | undefined;
await consumeInboundEmailOtp({
  inboundEmailId: "inbound_123",
  repository: {
    async consumeOtp(input) {
      consumedAt = input.consumedAt;
      assert.equal(input.inboundEmailId, "inbound_123");
    },
  },
  consumedAt: new Date("2026-04-29T10:05:00.000Z"),
});
assert.equal(consumedAt?.toISOString(), "2026-04-29T10:05:00.000Z");
console.log("inbound email workflow tests passed");
