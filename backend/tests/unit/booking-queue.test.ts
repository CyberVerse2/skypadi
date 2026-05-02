
import {
  enqueueSupplierBookingJobWithAddJob,
  supplierBookingJobKey,
  supplierBookingTaskName,
} from "../../src/jobs/booking-queue";
import { describe, expect, test } from "vitest";


describe("unit booking queue", () => {
  test("booking queue", async () => {
    const calls: unknown[] = [];

    await enqueueSupplierBookingJobWithAddJob(
      async (identifier, payload, spec) => {
        calls.push({ identifier, payload, spec });
        return { id: "graphile-job-id" };
      },
      { bookingId: "11111111-1111-4111-8111-111111111111" },
    );

    expect(supplierBookingTaskName).toBe("supplier-booking");
    expect(supplierBookingJobKey("abc")).toBe("supplier-booking:abc");
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

    console.log("booking queue tests passed");
  });
});
