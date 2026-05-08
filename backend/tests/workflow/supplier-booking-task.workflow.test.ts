
import {
  configuredWhatsAppClientFromEnv,
  createSupplierBookingTask,
  formatSupplierBookingError,
  isRetryableSupplierBookingError,
} from "../../src/jobs/tasks/supplier-booking.task";
import { shouldSkipSupplierBookingForStatus } from "../../src/jobs/tasks/supplier-booking-status";
import { describe, expect, test, vi } from "vitest";


describe("workflow supplier booking task workflow", () => {
  test.each([
    ["supplier_booking_pending", false],
    ["manual_review_required", true],
    ["awaiting_payment_for_hold", true],
    ["payment_pending", true],
    ["supplier_verification_required", true],
    ["issued", true],
    [undefined, false],
  ] as const)("skip decision for status %s is %s", (status, expected) => {
    expect.hasAssertions();

    expect(shouldSkipSupplierBookingForStatus(status)).toBe(expected);
  });

  test("does not configure WhatsApp notifications without env values", () => {
    expect.hasAssertions();

    expect(configuredWhatsAppClientFromEnv({})).toBe(undefined);
  });

  test.each([
    ["Wakanow API request failed with 502", true],
    ["fetch failed", true],
    ["Wakanow payment response was missing bank transfer details", false],
  ])("retryable supplier error %s is %s", (message, expected) => {
    expect.hasAssertions();

    expect(isRetryableSupplierBookingError(message)).toBe(expected);
  });

  test("formats supplier error details for persistence", () => {
    expect.hasAssertions();
    const error = Object.assign(new Error("Wakanow account login failed with 400"), {
      details: {
        status: 400,
        response: {
          error: "Invalid client",
        },
      },
    });

    expect(formatSupplierBookingError(error)).toBe(JSON.stringify({
      message: "Wakanow account login failed with 400",
      details: {
        status: 400,
        response: {
          error: "Invalid client",
        },
      },
    }));
  });

  test("marks supplier hold jobs succeeded even when WhatsApp notification fails", async () => {
    expect.hasAssertions();
    const markedSucceeded: string[] = [];
    const markedFailed: string[] = [];
    const supplierDecisionStatuses: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

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

    expect(supplierDecisionStatuses).toEqual(["awaiting_payment_for_hold"]);
    expect(markedSucceeded).toEqual(["booking-1"]);
    expect(markedFailed).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[supplier-booking] Supplier decision was recorded but WhatsApp notification failed",
      {
        bookingId: "booking-1",
        errorMessage: "WhatsApp unavailable",
      },
    );

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
