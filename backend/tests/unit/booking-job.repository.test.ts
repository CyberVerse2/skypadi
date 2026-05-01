import assert from "node:assert/strict";

import type { DbClient } from "../../src/db/client";
import { createDrizzleSupplierBookingJobRepository } from "../../src/jobs/booking-job.repository";

const executedQueries: unknown[] = [];
const existingQueuedAt = new Date("2026-05-01T09:59:00.000Z");
const existingUpdatedAt = new Date("2026-05-01T10:00:00.000Z");

const db = {
  async execute(query: unknown) {
    executedQueries.push(query);
    return {
      rows: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          booking_id: "11111111-1111-4111-8111-111111111111",
          graphile_job_key: "supplier-booking:11111111-1111-4111-8111-111111111111",
          status: "queued",
          attempt_count: 0,
          last_error: null,
          queued_at: existingQueuedAt,
          started_at: null,
          finished_at: null,
          updated_at: existingUpdatedAt,
        },
      ],
    };
  },
} as unknown as DbClient;

const repository = createDrizzleSupplierBookingJobRepository(db);

const created = await repository.createQueued({
  bookingId: "11111111-1111-4111-8111-111111111111",
  graphileJobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
  now: new Date("2026-05-01T10:01:00.000Z"),
});

assert.equal(created.id, "33333333-3333-4333-8333-333333333333");
assert.equal(created.queuedAt.toISOString(), "2026-05-01T09:59:00.000Z");
assert.equal(created.updatedAt.toISOString(), "2026-05-01T10:00:00.000Z");

const sqlText = sqlString(executedQueries[0]);
assert.match(
  sqlText,
  /returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at/,
);
assert.match(sqlText, /last_error = null/);
assert.match(sqlText, /started_at = null/);
assert.match(sqlText, /finished_at = null/);
assert.match(sqlText, /queued_at = excluded\.queued_at/);
assert.match(sqlText, /attempt_count = 0/);

console.log("booking job repository tests passed");

function sqlString(value: unknown): string {
  const chunks = (value as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  return chunks
    .flatMap((chunk) => {
      const stringChunk = chunk as { value?: unknown };
      return Array.isArray(stringChunk.value) ? stringChunk.value : [];
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
