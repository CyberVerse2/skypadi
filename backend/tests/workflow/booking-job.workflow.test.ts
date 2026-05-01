import assert from "node:assert/strict";

import {
  createSupplierBookingJobRecord,
  markSupplierBookingJobFailed,
  markSupplierBookingJobRunning,
  markSupplierBookingJobSucceeded,
} from "../../src/jobs/booking-job.repository";
import { test } from "vitest";

test("booking job workflow", async () => {
  const now = new Date("2026-05-01T10:00:00.000Z");

  const created = createSupplierBookingJobRecord({
    id: "22222222-2222-4222-8222-222222222222",
    bookingId: "11111111-1111-4111-8111-111111111111",
    graphileJobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
    now,
  });

  assert.equal(created.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(created.status, "queued");
  assert.equal(created.attemptCount, 0);
  assert.equal(created.bookingId, "11111111-1111-4111-8111-111111111111");

  const running = markSupplierBookingJobRunning(created, new Date("2026-05-01T10:01:00.000Z"));
  assert.equal(running.status, "running");
  assert.equal(running.attemptCount, 1);
  assert.equal(running.startedAt?.toISOString(), "2026-05-01T10:01:00.000Z");

  const succeeded = markSupplierBookingJobSucceeded(running, new Date("2026-05-01T10:05:00.000Z"));
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.finishedAt?.toISOString(), "2026-05-01T10:05:00.000Z");

  const failed = markSupplierBookingJobFailed(running, {
    failedAt: new Date("2026-05-01T10:06:00.000Z"),
    errorMessage: "browser timeout",
    retryable: true,
  });
  assert.equal(failed.status, "retryable_failed");
  assert.equal(failed.lastError, "browser timeout");

  const terminal = markSupplierBookingJobFailed(running, {
    failedAt: new Date("2026-05-01T10:07:00.000Z"),
    errorMessage: "supplier rejected passenger",
    retryable: false,
  });
  assert.equal(terminal.status, "terminal_failed");

  console.log("booking job workflow tests passed");
});
