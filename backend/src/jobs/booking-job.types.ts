export type SupplierBookingJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "retryable_failed"
  | "terminal_failed";

export type SupplierBookingJobPayload = {
  bookingId: string;
};

export type SupplierBookingJobRecord = {
  id: string;
  bookingId: string;
  graphileJobKey: string;
  status: SupplierBookingJobStatus;
  attemptCount: number;
  lastError?: string;
  queuedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  updatedAt: Date;
};

export type CreateSupplierBookingJobInput = {
  id: string;
  bookingId: string;
  graphileJobKey: string;
  now: Date;
};

export type SupplierBookingJobRepository = {
  createQueued(input: Omit<CreateSupplierBookingJobInput, "id">): Promise<SupplierBookingJobRecord>;
  markRunning(input: { bookingId: string; startedAt: Date }): Promise<SupplierBookingJobRecord>;
  markSucceeded(input: { bookingId: string; finishedAt: Date }): Promise<SupplierBookingJobRecord>;
  markFailed(input: {
    bookingId: string;
    failedAt: Date;
    errorMessage: string;
    retryable: boolean;
  }): Promise<SupplierBookingJobRecord>;
};
