import assert from "node:assert/strict";

import { normalizeWakanowHoldStatus } from "../../src/integrations/wakanow/wakanow.booking.js";
import { handleSupplierHoldResult, recordSupplierHoldDecision } from "../../src/workflows/supplier-booking.workflow.js";

const hold = handleSupplierHoldResult({
  bookingId: "book_123",
  result: {
    kind: "hold_created",
    supplier: "wakanow",
    supplierBookingRef: "WK123",
    expiresAt: new Date("2026-04-29T18:00:00.000Z"),
    amountDue: 161000,
    currency: "NGN",
    paymentUrl: "https://pay.example/wk123",
    rawStatus: "Active",
  },
});

assert.equal(hold.status, "awaiting_payment_for_hold");
assert.equal(hold.supplierBookingRef, "WK123");
assert.equal(hold.policy, "hold_first");
assert.equal(hold.holdMode, "hold_created");
assert.equal(hold.paymentUrl, "https://pay.example/wk123");

const normalized = normalizeWakanowHoldStatus({
  status: "Active",
  supplierBookingRef: "WK124",
  expiresAt: "2026-04-29T18:00:00.000Z",
  amountDue: 161000,
});
assert.equal(normalized.kind, "hold_created");
if (normalized.kind === "hold_created") {
  assert.equal(normalized.expiresAt.toISOString(), "2026-04-29T18:00:00.000Z");
}

const missingAmount = normalizeWakanowHoldStatus({
  status: "InstantPurchase",
});
assert.equal(missingAmount.kind, "unclear");

const instant = handleSupplierHoldResult({
  bookingId: "book_456",
  result: {
    kind: "instant_purchase_required",
    supplier: "wakanow",
    reason: "Travel date is less than one week away",
    amountDue: 161000,
    currency: "NGN",
    rawStatus: "InstantPurchase",
  },
});

assert.equal(instant.status, "payment_pending");
assert.equal(instant.policy, "payment_first");

const unavailable = handleSupplierHoldResult({
  bookingId: "book_789",
  result: {
    kind: "hold_unavailable",
    supplier: "wakanow",
    reason: "Supplier did not offer a hold",
    rawStatus: "HoldUnavailable",
  },
});

assert.equal(unavailable.status, "payment_pending");
assert.equal(unavailable.policy, "payment_first");
assert.equal(unavailable.amountDue, undefined);

const unclear = handleSupplierHoldResult({
  bookingId: "book_unclear",
  result: {
    kind: "unclear",
    supplier: "wakanow",
    reason: "Unexpected response",
    rawStatus: "???",
  },
});

assert.equal(unclear.status, "manual_review_required");
assert.equal(unclear.policy, "manual_review");

const applied: unknown[] = [];
await recordSupplierHoldDecision({
  decision: hold,
  repository: {
    async applySupplierDecision(input) {
      applied.push(input);
    },
  },
  observedAt: new Date("2026-04-29T09:05:00.000Z"),
});
assert.equal(applied.length, 1);
assert.deepEqual(applied[0], {
  bookingId: "book_123",
  status: "awaiting_payment_for_hold",
  supplier: "wakanow",
  supplierBookingRef: "WK123",
  holdExpiresAt: new Date("2026-04-29T18:00:00.000Z"),
  amountDue: 161000,
  currency: "NGN",
  failureReason: undefined,
  eventType: "supplier_hold.hold_created",
  eventPayload: {
    status: "awaiting_payment_for_hold",
    policy: "hold_first",
    holdMode: "hold_created",
    supplierBookingRef: "WK123",
    holdExpiresAt: "2026-04-29T18:00:00.000Z",
    amountDue: 161000,
    currency: "NGN",
    paymentUrl: "https://pay.example/wk123",
    reason: undefined,
    rawStatus: "Active",
  },
  observedAt: new Date("2026-04-29T09:05:00.000Z"),
});
console.log("supplier booking workflow tests passed");
