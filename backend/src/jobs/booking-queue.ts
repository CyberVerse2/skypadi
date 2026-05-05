import { makeWorkerUtils } from "graphile-worker";

import type { SupplierBookingJobPayload } from "./booking-job.types";

export const supplierBookingTaskName = "supplier-booking";

export type SupplierBookingJobSpec = {
  queueName: typeof supplierBookingTaskName;
  maxAttempts: 3;
  jobKey: string;
  jobKeyMode: "unsafe_dedupe";
};

export type SupplierBookingAddJob = (
  identifier: typeof supplierBookingTaskName,
  payload: SupplierBookingJobPayload,
  spec: SupplierBookingJobSpec,
) => Promise<unknown>;

export type SupplierBookingEnqueue = (payload: SupplierBookingJobPayload) => Promise<void>;

type SupplierBookingWorkerUtils = {
  addJob: SupplierBookingAddJob;
  release(): Promise<void>;
};

type SupplierBookingWorkerUtilsFactory = (input: { connectionString: string }) => Promise<SupplierBookingWorkerUtils>;

export function supplierBookingJobKey(bookingId: string): string {
  return `${supplierBookingTaskName}:${bookingId}`;
}

export async function enqueueSupplierBookingJobWithAddJob(
  addJob: SupplierBookingAddJob,
  payload: SupplierBookingJobPayload,
): Promise<void> {
  await addJob(supplierBookingTaskName, payload, {
    queueName: supplierBookingTaskName,
    maxAttempts: 3,
    jobKey: supplierBookingJobKey(payload.bookingId),
    jobKeyMode: "unsafe_dedupe",
  });
}

export function createSupplierBookingJobEnqueuer(input: {
  connectionString?: string;
  makeWorkerUtils?: SupplierBookingWorkerUtilsFactory;
} = {}): { enqueue: SupplierBookingEnqueue; release: () => Promise<void> } {
  let workerUtilsPromise: Promise<SupplierBookingWorkerUtils> | undefined;
  const createWorkerUtils = input.makeWorkerUtils ?? defaultMakeWorkerUtils;

  async function workerUtils(): Promise<SupplierBookingWorkerUtils> {
    if (!workerUtilsPromise) {
      const connectionString = input.connectionString ?? process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL is required to enqueue supplier booking jobs");
      }

      workerUtilsPromise = createWorkerUtils({ connectionString }).catch((error: unknown) => {
        workerUtilsPromise = undefined;
        throw error;
      });
    }

    return workerUtilsPromise;
  }

  return {
    async enqueue(payload) {
      const utils = await workerUtils();
      await enqueueSupplierBookingJobWithAddJob(utils.addJob, payload);
    },
    async release() {
      const utils = workerUtilsPromise ? await workerUtilsPromise : undefined;
      workerUtilsPromise = undefined;
      await utils?.release();
    },
  };
}

const defaultSupplierBookingJobEnqueuer = createSupplierBookingJobEnqueuer();

export async function enqueueSupplierBookingJob(payload: SupplierBookingJobPayload): Promise<void> {
  await defaultSupplierBookingJobEnqueuer.enqueue(payload);
}

async function defaultMakeWorkerUtils(input: { connectionString: string }): Promise<SupplierBookingWorkerUtils> {
  const workerUtils = await makeWorkerUtils({ connectionString: input.connectionString });
  return {
    addJob: workerUtils.addJob,
    release: async () => {
      await workerUtils.release();
    },
  };
}
