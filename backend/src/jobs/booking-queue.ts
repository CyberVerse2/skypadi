import type { AddJobFunction } from "graphile-worker";
import { makeWorkerUtils } from "graphile-worker";

import type { SupplierBookingJobPayload } from "./booking-job.types";

export const supplierBookingTaskName = "supplier-booking";

export function supplierBookingJobKey(bookingId: string): string {
  return `${supplierBookingTaskName}:${bookingId}`;
}

export async function enqueueSupplierBookingJobWithAddJob(
  addJob: AddJobFunction,
  payload: SupplierBookingJobPayload,
): Promise<void> {
  await addJob(supplierBookingTaskName, payload, {
    queueName: supplierBookingTaskName,
    maxAttempts: 3,
    jobKey: supplierBookingJobKey(payload.bookingId),
    jobKeyMode: "unsafe_dedupe",
  });
}

export async function enqueueSupplierBookingJob(payload: SupplierBookingJobPayload): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to enqueue supplier booking jobs");
  }

  const workerUtils = await makeWorkerUtils({ connectionString });

  try {
    await enqueueSupplierBookingJobWithAddJob(workerUtils.addJob, payload);
  } finally {
    await workerUtils.release();
  }
}
