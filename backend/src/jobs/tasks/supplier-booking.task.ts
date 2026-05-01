import type { Task } from "graphile-worker";

import { db } from "../../db/client";
import { createWakanowBrowserHoldClient } from "../../integrations/wakanow/wakanow.booking";
import {
  createDrizzleSupplierBookingRepository,
  handleSupplierHoldResult,
  recordSupplierHoldDecision,
} from "../../workflows/supplier-booking.workflow";
import { createDrizzleSupplierBookingJobRepository } from "../booking-job.repository";
import type { SupplierBookingJobPayload } from "../booking-job.types";

export const supplierBookingTask: Task = async (payload) => {
  assertSupplierBookingPayload(payload);

  const jobRepository = createDrizzleSupplierBookingJobRepository(db);
  await jobRepository.markRunning({ bookingId: payload.bookingId, startedAt: new Date() });

  try {
    const supplierClient = createWakanowBrowserHoldClient({ db });
    const supplierRepository = createDrizzleSupplierBookingRepository(db);
    const supplierResult = await supplierClient.createHoldForBooking({ bookingId: payload.bookingId });
    const decision = handleSupplierHoldResult({ bookingId: payload.bookingId, result: supplierResult });

    await recordSupplierHoldDecision({
      decision,
      repository: supplierRepository,
      observedAt: new Date(),
    });
    await jobRepository.markSucceeded({ bookingId: payload.bookingId, finishedAt: new Date() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier booking job failed";
    await jobRepository.markFailed({
      bookingId: payload.bookingId,
      failedAt: new Date(),
      errorMessage: message,
      retryable: isRetryableSupplierBookingError(message),
    });
    throw error;
  }
};

function assertSupplierBookingPayload(payload: unknown): asserts payload is SupplierBookingJobPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid supplier booking payload");
  }

  const value = payload as Record<string, unknown>;
  if (typeof value.bookingId !== "string" || value.bookingId.length === 0) {
    throw new Error("Invalid supplier booking payload bookingId");
  }
}

function isRetryableSupplierBookingError(message: string): boolean {
  return /timeout|network|browser|navigation|temporar/i.test(message);
}
