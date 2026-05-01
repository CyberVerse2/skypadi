import assert from "node:assert/strict";

import { createSupplierBookingTask } from "../../src/jobs/tasks/supplier-booking.task";
import { shouldSkipSupplierBookingForStatus } from "../../src/jobs/tasks/supplier-booking-status";

assert.equal(shouldSkipSupplierBookingForStatus("supplier_booking_pending"), false);
assert.equal(shouldSkipSupplierBookingForStatus("manual_review_required"), true);
assert.equal(shouldSkipSupplierBookingForStatus("awaiting_payment_for_hold"), true);
assert.equal(shouldSkipSupplierBookingForStatus("payment_pending"), true);
assert.equal(shouldSkipSupplierBookingForStatus("supplier_verification_required"), true);
assert.equal(shouldSkipSupplierBookingForStatus("issued"), true);
assert.equal(shouldSkipSupplierBookingForStatus(undefined), false);

const markedSucceeded: string[] = [];
const markedFailed: string[] = [];
const supplierDecisionStatuses: string[] = [];
const originalWarn = console.warn;
console.warn = () => {};

try {
  const task = createSupplierBookingTask({
    jobRepository: {
      async createQueued() {
        throw new Error("unused");
      },
      async markRunning(input) {
        return jobRecord(input.bookingId, "running");
      },
      async markSucceeded(input) {
        markedSucceeded.push(input.bookingId);
        return jobRecord(input.bookingId, "succeeded");
      },
      async markFailed(input) {
        markedFailed.push(input.bookingId);
        return jobRecord(input.bookingId, input.retryable ? "retryable_failed" : "terminal_failed");
      },
    },
    async findBookingStatus() {
      return "supplier_booking_pending";
    },
    supplierClient: {
      async createHoldForBooking() {
        return {
          kind: "hold_created",
          supplier: "wakanow",
          supplierBookingRef: "WK123",
          expiresAt: new Date("2026-05-01T16:00:00.000Z"),
          amountDue: 120000,
          currency: "NGN",
          rawStatus: "hold_created",
        };
      },
    },
    supplierRepository: {
      async applySupplierDecision(input) {
        supplierDecisionStatuses.push(input.status);
      },
    },
    async notifyRecordedDecision() {
      throw new Error("WhatsApp unavailable");
    },
  });

  await task({ bookingId: "booking-1" }, {} as never);
} finally {
  console.warn = originalWarn;
}

assert.deepEqual(supplierDecisionStatuses, ["awaiting_payment_for_hold"]);
assert.deepEqual(markedSucceeded, ["booking-1"]);
assert.deepEqual(markedFailed, []);

console.log("supplier booking task workflow tests passed");

function jobRecord(
  bookingId: string,
  status: "queued" | "running" | "succeeded" | "retryable_failed" | "terminal_failed",
) {
  const now = new Date("2026-05-01T10:00:00.000Z");
  return {
    id: `job-${bookingId}`,
    bookingId,
    graphileJobKey: `supplier-booking:${bookingId}`,
    status,
    attemptCount: status === "running" ? 1 : 0,
    queuedAt: now,
    updatedAt: now,
  };
}
