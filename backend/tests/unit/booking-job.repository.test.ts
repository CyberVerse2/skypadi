
import type { DbClient } from "../../src/db/client";
import { createDrizzleSupplierBookingJobRepository } from "../../src/jobs/booking-job.repository";
import { describe, expect, test } from "vitest";


describe("unit booking job repository", () => {
  test("booking job repository", async () => {
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

    expect(created.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(created.queuedAt.toISOString()).toBe("2026-05-01T09:59:00.000Z");
    expect(created.updatedAt.toISOString()).toBe("2026-05-01T10:00:00.000Z");

    const sqlText = sqlString(executedQueries[0]);
    expect(sqlText).toMatch(/returning id, booking_id, graphile_job_key, status, attempt_count, last_error, queued_at, started_at, finished_at, updated_at/);
    expect(sqlText).toMatch(/last_error = null/);
    expect(sqlText).toMatch(/started_at = null/);
    expect(sqlText).toMatch(/finished_at = null/);
    expect(sqlText).toMatch(/queued_at = excluded\.queued_at/);
    expect(sqlText).toMatch(/attempt_count = 0/);

    await repository.markRunning({
      bookingId: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-05-01T10:02:00.000Z"),
    });

    const markRunningSqlText = sqlString(executedQueries[1]);
    expect(markRunningSqlText).toMatch(/last_error = null/);
    expect(markRunningSqlText).toMatch(/finished_at = null/);

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
  });
});
