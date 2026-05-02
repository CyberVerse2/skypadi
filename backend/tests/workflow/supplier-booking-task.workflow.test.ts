
import {
  configuredWhatsAppClientFromEnv,
  createSupplierBookingTask,
  isRetryableSupplierBookingError,
} from "../../src/jobs/tasks/supplier-booking.task";
import { shouldSkipSupplierBookingForStatus } from "../../src/jobs/tasks/supplier-booking-status";
import { describe, expect, test } from "vitest";


describe("workflow supplier booking task workflow", () => {
  test("supplier booking task workflow", async () => {
    expect(shouldSkipSupplierBookingForStatus("supplier_booking_pending")).toBe(false);
    expect(shouldSkipSupplierBookingForStatus("manual_review_required")).toBe(true);
    expect(shouldSkipSupplierBookingForStatus("awaiting_payment_for_hold")).toBe(true);
    expect(shouldSkipSupplierBookingForStatus("payment_pending")).toBe(true);
    expect(shouldSkipSupplierBookingForStatus("supplier_verification_required")).toBe(true);
    expect(shouldSkipSupplierBookingForStatus("issued")).toBe(true);
    expect(shouldSkipSupplierBookingForStatus(undefined)).toBe(false);
    expect(configuredWhatsAppClientFromEnv({})).toBe(undefined);
    expect(isRetryableSupplierBookingError("Wakanow API request failed with 502")).toBe(true);
    expect(isRetryableSupplierBookingError("fetch failed")).toBe(true);
    expect(isRetryableSupplierBookingError("Wakanow payment response was missing bank transfer details")).toBe(false);

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

    expect(supplierDecisionStatuses).toEqual(["awaiting_payment_for_hold"]);
    expect(markedSucceeded).toEqual(["booking-1"]);
    expect(markedFailed).toEqual([]);

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
  });
});
