
import {
  createSupplierBookingJobRecord,
  markSupplierBookingJobFailed,
  markSupplierBookingJobRunning,
  markSupplierBookingJobSucceeded,
} from "../../src/jobs/booking-job.repository";
import { describe, expect, test } from "vitest";


describe("workflow booking job workflow", () => {
  test("booking job workflow", async () => {
    const now = new Date("2026-05-01T10:00:00.000Z");

    const created = createSupplierBookingJobRecord({
      id: "22222222-2222-4222-8222-222222222222",
      bookingId: "11111111-1111-4111-8111-111111111111",
      graphileJobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
      now,
    });

    expect(created.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(created.status).toBe("queued");
    expect(created.attemptCount).toBe(0);
    expect(created.bookingId).toBe("11111111-1111-4111-8111-111111111111");

    const running = markSupplierBookingJobRunning(created, new Date("2026-05-01T10:01:00.000Z"));
    expect(running.status).toBe("running");
    expect(running.attemptCount).toBe(1);
    expect(running.startedAt?.toISOString()).toBe("2026-05-01T10:01:00.000Z");

    const succeeded = markSupplierBookingJobSucceeded(running, new Date("2026-05-01T10:05:00.000Z"));
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.finishedAt?.toISOString()).toBe("2026-05-01T10:05:00.000Z");

    const failed = markSupplierBookingJobFailed(running, {
      failedAt: new Date("2026-05-01T10:06:00.000Z"),
      errorMessage: "browser timeout",
      retryable: true,
    });
    expect(failed.status).toBe("retryable_failed");
    expect(failed.lastError).toBe("browser timeout");

    const terminal = markSupplierBookingJobFailed(running, {
      failedAt: new Date("2026-05-01T10:07:00.000Z"),
      errorMessage: "supplier rejected passenger",
      retryable: false,
    });
    expect(terminal.status).toBe("terminal_failed");

    console.log("booking job workflow tests passed");
  });
});
