import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import type { DbClient } from "../db/client";
import type {
  CreateSupplierBookingJobInput,
  SupplierBookingJobRecord,
  SupplierBookingJobRepository,
} from "./booking-job.types";

export function createSupplierBookingJobRecord(input: CreateSupplierBookingJobInput): SupplierBookingJobRecord {
  return {
    id: input.id,
    bookingId: input.bookingId,
    graphileJobKey: input.graphileJobKey,
    status: "queued",
    attemptCount: 0,
    queuedAt: input.now,
    updatedAt: input.now,
  };
}

export function markSupplierBookingJobRunning(record: SupplierBookingJobRecord, startedAt: Date): SupplierBookingJobRecord {
  return {
    ...record,
    status: "running",
    attemptCount: record.attemptCount + 1,
    startedAt,
    updatedAt: startedAt,
  };
}

export function markSupplierBookingJobSucceeded(record: SupplierBookingJobRecord, finishedAt: Date): SupplierBookingJobRecord {
  return {
    ...record,
    status: "succeeded",
    finishedAt,
    updatedAt: finishedAt,
  };
}

export function markSupplierBookingJobFailed(
  record: SupplierBookingJobRecord,
  input: { failedAt: Date; errorMessage: string; retryable: boolean },
): SupplierBookingJobRecord {
  return {
    ...record,
    status: input.retryable ? "retryable_failed" : "terminal_failed",
    lastError: input.errorMessage,
    finishedAt: input.failedAt,
    updatedAt: input.failedAt,
  };
}

export function createDrizzleSupplierBookingJobRepository(db: DbClient): SupplierBookingJobRepository {
  return {
    async createQueued(input) {
      const record = createSupplierBookingJobRecord({
        ...input,
        id: randomUUID(),
      });
      const result = await db.execute(sql`
        insert into skypadi_whatsapp.supplier_booking_jobs (
          id,
          booking_id,
          graphile_job_key,
          status,
          attempt_count,
          queued_at,
          updated_at
        )
        values (
          ${record.id},
          ${record.bookingId},
          ${record.graphileJobKey},
          ${record.status},
          ${record.attemptCount},
          ${record.queuedAt},
          ${record.updatedAt}
        )
        on conflict (booking_id) do update
          set graphile_job_key = excluded.graphile_job_key,
              status = 'queued',
              attempt_count = 0,
              last_error = null,
              queued_at = excluded.queued_at,
              started_at = null,
              finished_at = null,
              updated_at = excluded.updated_at
        returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at
      `);
      return rowToRecord(result.rows[0]);
    },
    async markRunning(input) {
      const result = await db.execute(sql`
        update skypadi_whatsapp.supplier_booking_jobs
        set status = 'running',
            attempt_count = attempt_count + 1,
            last_error = null,
            started_at = ${input.startedAt},
            finished_at = null,
            updated_at = ${input.startedAt}
        where booking_id = ${input.bookingId}
        returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at
      `);
      return rowToRecord(result.rows[0]);
    },
    async markSucceeded(input) {
      const result = await db.execute(sql`
        update skypadi_whatsapp.supplier_booking_jobs
        set status = 'succeeded',
            finished_at = ${input.finishedAt},
            updated_at = ${input.finishedAt}
        where booking_id = ${input.bookingId}
        returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at
      `);
      return rowToRecord(result.rows[0]);
    },
    async markFailed(input) {
      const status = input.retryable ? "retryable_failed" : "terminal_failed";
      const result = await db.execute(sql`
        update skypadi_whatsapp.supplier_booking_jobs
        set status = ${status},
            last_error = ${input.errorMessage},
            finished_at = ${input.failedAt},
            updated_at = ${input.failedAt}
        where booking_id = ${input.bookingId}
        returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at
      `);
      return rowToRecord(result.rows[0]);
    },
  };
}

function rowToRecord(row: unknown): SupplierBookingJobRecord {
  if (!row || typeof row !== "object") {
    throw new Error("Supplier booking job was not found");
  }

  const value = row as Record<string, unknown>;
  return {
    id: stringField(value.id),
    bookingId: stringField(value.booking_id),
    graphileJobKey: stringField(value.graphile_job_key),
    status: stringField(value.status) as SupplierBookingJobRecord["status"],
    attemptCount: numberField(value.attempt_count),
    lastError: optionalStringField(value.last_error),
    queuedAt: dateField(value.queued_at),
    startedAt: optionalDateField(value.started_at),
    finishedAt: optionalDateField(value.finished_at),
    updatedAt: dateField(value.updated_at),
  };
}

function stringField(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string database field");
  }
  return value;
}

function optionalStringField(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return stringField(value);
}

function numberField(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  throw new Error("Expected number database field");
}

function dateField(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  throw new Error("Expected date database field");
}

function optionalDateField(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  return dateField(value);
}
