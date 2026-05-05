import assert from "node:assert/strict";

import {
  createSupplierBookingJobEnqueuer,
  enqueueSupplierBookingJobWithAddJob,
  supplierBookingJobKey,
  supplierBookingTaskName,
} from "../../src/jobs/booking-queue";
import { test } from "vitest";

test("booking queue", async () => {
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

  const workerUtilsCalls: string[] = [];
  const released: string[] = [];
  const reusableCalls: unknown[] = [];
  const enqueuer = createSupplierBookingJobEnqueuer({
    connectionString: "postgres://example",
    makeWorkerUtils: async ({ connectionString }) => {
      workerUtilsCalls.push(connectionString);
      return {
        addJob: async (identifier, payload, spec) => {
          reusableCalls.push({ identifier, payload, spec });
          return { id: "graphile-job-id" };
        },
        release: async () => {
          released.push("released");
        },
      };
    },
  });

  await enqueuer.enqueue({ bookingId: "booking-1" });
  await enqueuer.enqueue({ bookingId: "booking-2" });
  await enqueuer.release();

  assert.deepEqual(workerUtilsCalls, ["postgres://example"]);
  assert.equal(reusableCalls.length, 2);
  assert.deepEqual(released, ["released"]);

  let factoryAttempts = 0;
  const retryingEnqueuer = createSupplierBookingJobEnqueuer({
    connectionString: "postgres://retry",
    makeWorkerUtils: async () => {
      factoryAttempts += 1;
      if (factoryAttempts === 1) {
        throw new Error("database unavailable");
      }
      return {
        addJob: async () => ({ id: "graphile-job-id" }),
        release: async () => {},
      };
    },
  });

  await assert.rejects(() => retryingEnqueuer.enqueue({ bookingId: "booking-retry" }), /database unavailable/);
  await retryingEnqueuer.enqueue({ bookingId: "booking-retry" });
  assert.equal(factoryAttempts, 2);

  console.log("booking queue tests passed");
});
