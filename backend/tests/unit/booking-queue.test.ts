
import {
  enqueueSupplierBookingJobWithAddJob,
  supplierBookingJobKey,
  supplierBookingTaskName,
} from "../../src/jobs/booking-queue";
import { describe, expect, test } from "vitest";


describe("unit booking queue", () => {
  test.each([
    ["abc", "supplier-booking:abc"],
    ["11111111-1111-4111-8111-111111111111", "supplier-booking:11111111-1111-4111-8111-111111111111"],
    ["booking:with:colon", "supplier-booking:booking:with:colon"],
  ])("builds supplier booking job key for %s", (bookingId, expected) => {
    expect.hasAssertions();

    expect(supplierBookingJobKey(bookingId)).toBe(expected);
  });

  test("enqueues supplier booking jobs with dedupe metadata", async () => {
    expect.hasAssertions();
    const calls: unknown[] = [];

    await enqueueSupplierBookingJobWithAddJob(
      async (identifier, payload, spec) => {
        calls.push({ identifier, payload, spec });
        return { id: "graphile-job-id" };
      },
      { bookingId: "11111111-1111-4111-8111-111111111111" },
    );

    expect(supplierBookingTaskName).toBe("supplier-booking");
    expect(calls).toEqual([
      {
        identifier: "supplier-booking",
        payload: { bookingId: "11111111-1111-4111-8111-111111111111" },
        spec: {
          queueName: "supplier-booking",
          maxAttempts: 3,
          jobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
          jobKeyMode: "unsafe_dedupe",
        },
      },
    ]);
  });
});
