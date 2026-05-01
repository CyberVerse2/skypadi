import assert from "node:assert/strict";

import {
  enqueueSupplierBookingJobWithAddJob,
  supplierBookingJobKey,
  supplierBookingTaskName,
} from "../../src/jobs/booking-queue";

const calls: unknown[] = [];

await enqueueSupplierBookingJobWithAddJob(
  async (identifier, payload, spec) => {
    calls.push({ identifier, payload, spec });
    return { id: "graphile-job-id" };
  },
  { bookingId: "11111111-1111-4111-8111-111111111111" },
);

assert.equal(supplierBookingTaskName, "supplier-booking");
assert.equal(supplierBookingJobKey("abc"), "supplier-booking:abc");
assert.deepEqual(calls, [
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
