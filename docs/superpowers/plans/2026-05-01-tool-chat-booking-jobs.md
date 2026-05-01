# Tool Chat and Booking Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed WhatsApp conversation workflow with a minimal tool-based chat loop while moving Wakanow/Patchright booking execution into durable Graphile Worker jobs.

**Architecture:** The WhatsApp API process receives messages, loads conversation/booking context, asks the AI for a concise response plus optional tool call, and executes only fast/safe tools inline. Flight search remains synchronous enough for the chat request; supplier booking becomes an asynchronous Graphile Worker task that validates booking state, runs Wakanow/Patchright, records supplier decisions, and sends a WhatsApp update. Booking state remains deterministic in Postgres, and Graphile Worker is used only as durable execution infrastructure.

**Tech Stack:** TypeScript, Fastify, Drizzle/Postgres, AI SDK, OpenAI, Graphile Worker, Patchright, WhatsApp Cloud API.

---

## Scope Check

This plan intentionally covers one migration slice:

- Minimal tool-based WhatsApp chat routing.
- Flight search as the only direct AI tool.
- Booking execution as a durable job.
- Worker runtime, queue adapter, and booking job task.

It does not introduce weather tools, fare policy tools, profile management tools, card payment provider integration, Redis, or a separate orchestration service.

## File Structure

- `backend/src/tools/chat-tool.types.ts`: shared AI tool request/result contracts.
- `backend/src/tools/chat-agent.ts`: OpenAI-backed chat router that returns either a concise text reply or a validated tool request.
- `backend/src/tools/search-flights.tool.ts`: executes the flight-search tool and returns WhatsApp `UiIntent`.
- `backend/src/tools/start-booking-job.tool.ts`: validates booking state and enqueues the supplier booking job.
- `backend/src/jobs/booking-job.types.ts`: supplier booking job payload and status contracts.
- `backend/src/jobs/booking-job.repository.ts`: app-owned job ledger and booking-state updates.
- `backend/src/jobs/booking-queue.ts`: Graphile Worker enqueue utility.
- `backend/src/jobs/tasks/supplier-booking.task.ts`: Graphile Worker task that runs Wakanow/Patchright.
- `backend/src/jobs/task-list.ts`: task registry for Graphile Worker.
- `backend/src/worker.ts`: worker process entrypoint.
- `backend/src/channels/whatsapp/whatsapp.tool-routes.ts`: tool-based WhatsApp webhook route.
- `backend/src/app.ts`: wires WhatsApp to tool routes instead of workflow routes.
- `backend/src/db/schema.ts`: adds app-owned supplier booking job ledger.
- `backend/tests/unit/chat-agent.test.ts`: verifies tool-router prompt/result behavior with fake model.
- `backend/tests/workflow/booking-job.workflow.test.ts`: verifies job ledger and booking job state transitions.
- `backend/tests/integration/whatsapp.tool-routes.test.ts`: verifies WhatsApp webhook tool path.
- `backend/package.json`: adds Graphile Worker dependency, worker scripts, and dual bundle outputs.
- `backend/Dockerfile`: builds both web and worker entrypoints.

## Task 1: Add Graphile Worker Runtime and Build Scripts

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/Dockerfile`
- Create: `backend/src/worker.ts`
- Create: `backend/src/jobs/task-list.ts`
- Test: command-level verification

- [ ] **Step 1: Install Graphile Worker**

Run:

```bash
cd backend
npm install graphile-worker
```

Expected: `package.json` and `package-lock.json` include `graphile-worker`.

- [ ] **Step 2: Add worker entrypoint**

Create `backend/src/worker.ts`:

```ts
import { run } from "graphile-worker";

import { env } from "./config";
import { taskList } from "./jobs/task-list";

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to start the worker");
  }

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    noHandleSignals: false,
    pollInterval: 1000,
    taskList,
  });

  await runner.promise;
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
```

- [ ] **Step 3: Add empty task registry**

Create `backend/src/jobs/task-list.ts`:

```ts
import type { TaskList } from "graphile-worker";

export const taskList: TaskList = {};
```

- [ ] **Step 4: Update package scripts**

Modify `backend/package.json` scripts to this shape:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:worker": "tsx watch src/worker.ts",
    "build": "npm run typecheck && npm run bundle",
    "bundle": "npm run bundle:web && npm run bundle:worker",
    "bundle:web": "esbuild src/index.ts --bundle --platform=node --format=esm --target=es2022 --packages=external --outfile=dist/index.js",
    "bundle:worker": "esbuild src/worker.ts --bundle --platform=node --format=esm --target=es2022 --packages=external --outfile=dist/worker.js",
    "start": "node dist/index.js",
    "start:worker": "node dist/worker.js"
  }
}
```

Keep the existing test scripts after these entries.

- [ ] **Step 5: Update Docker build**

Modify `backend/Dockerfile` so the existing `RUN npm run build` remains the build command. No separate Dockerfile is needed. The deploy platform will run either:

```bash
node dist/index.js
```

or:

```bash
node dist/worker.js
```

- [ ] **Step 6: Verify build**

Run:

```bash
cd backend
npm run build
```

Expected: PASS and both files exist:

```text
dist/index.js
dist/worker.js
```

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/Dockerfile backend/src/worker.ts backend/src/jobs/task-list.ts
git commit -m "chore: add graphile worker runtime"
```

## Task 2: Add Supplier Booking Job Ledger

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/src/jobs/booking-job.types.ts`
- Create: `backend/src/jobs/booking-job.repository.ts`
- Create: `backend/tests/workflow/booking-job.workflow.test.ts`

- [ ] **Step 1: Write failing job ledger test**

Create `backend/tests/workflow/booking-job.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import {
  createSupplierBookingJobRecord,
  markSupplierBookingJobRunning,
  markSupplierBookingJobSucceeded,
  markSupplierBookingJobFailed,
} from "../../src/jobs/booking-job.repository";

const now = new Date("2026-05-01T10:00:00.000Z");

const created = createSupplierBookingJobRecord({
  bookingId: "11111111-1111-4111-8111-111111111111",
  graphileJobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
  now,
});

assert.equal(created.status, "queued");
assert.equal(created.attemptCount, 0);
assert.equal(created.bookingId, "11111111-1111-4111-8111-111111111111");

const running = markSupplierBookingJobRunning(created, new Date("2026-05-01T10:01:00.000Z"));
assert.equal(running.status, "running");
assert.equal(running.attemptCount, 1);
assert.equal(running.startedAt?.toISOString(), "2026-05-01T10:01:00.000Z");

const succeeded = markSupplierBookingJobSucceeded(running, new Date("2026-05-01T10:05:00.000Z"));
assert.equal(succeeded.status, "succeeded");
assert.equal(succeeded.finishedAt?.toISOString(), "2026-05-01T10:05:00.000Z");

const failed = markSupplierBookingJobFailed(running, {
  failedAt: new Date("2026-05-01T10:06:00.000Z"),
  errorMessage: "browser timeout",
  retryable: true,
});
assert.equal(failed.status, "retryable_failed");
assert.equal(failed.lastError, "browser timeout");

const terminal = markSupplierBookingJobFailed(running, {
  failedAt: new Date("2026-05-01T10:07:00.000Z"),
  errorMessage: "supplier rejected passenger",
  retryable: false,
});
assert.equal(terminal.status, "terminal_failed");

console.log("booking job workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/booking-job.workflow.test.ts
```

Expected: FAIL because `src/jobs/booking-job.repository.ts` does not exist.

- [ ] **Step 3: Add job types**

Create `backend/src/jobs/booking-job.types.ts`:

```ts
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
  bookingId: string;
  graphileJobKey: string;
  now: Date;
};

export type SupplierBookingJobRepository = {
  createQueued(input: CreateSupplierBookingJobInput): Promise<SupplierBookingJobRecord>;
  markRunning(input: { bookingId: string; startedAt: Date }): Promise<SupplierBookingJobRecord>;
  markSucceeded(input: { bookingId: string; finishedAt: Date }): Promise<SupplierBookingJobRecord>;
  markFailed(input: {
    bookingId: string;
    failedAt: Date;
    errorMessage: string;
    retryable: boolean;
  }): Promise<SupplierBookingJobRecord>;
};
```

- [ ] **Step 4: Add pure state helpers and repository skeleton**

Create `backend/src/jobs/booking-job.repository.ts`:

```ts
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
    id: randomUUID(),
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
  input: { failedAt: Date; errorMessage: string; retryable: boolean }
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
      const record = createSupplierBookingJobRecord(input);
      await db.execute(sql`
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
              updated_at = excluded.updated_at
        returning id
      `);
      return record;
    },
    async markRunning(input) {
      const result = await db.execute(sql`
        update skypadi_whatsapp.supplier_booking_jobs
        set status = 'running',
            attempt_count = attempt_count + 1,
            started_at = ${input.startedAt},
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
  if (typeof value !== "string") throw new Error("Expected string database field");
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
```

- [ ] **Step 5: Add Drizzle schema table**

In `backend/src/db/schema.ts`, add this enum near the existing enums:

```ts
export const supplierBookingJobStatusEnum = skypadi.enum("supplier_booking_job_status", [
  "queued",
  "running",
  "succeeded",
  "retryable_failed",
  "terminal_failed",
]);
```

Add this table after `bookings`:

```ts
export const supplierBookingJobs = skypadi.table(
  "supplier_booking_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    graphileJobKey: text("graphile_job_key").notNull(),
    status: supplierBookingJobStatusEnum("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    bookingIdIdx: uniqueIndex("supplier_booking_jobs_booking_id_idx").on(table.bookingId),
    graphileJobKeyIdx: uniqueIndex("supplier_booking_jobs_graphile_job_key_idx").on(table.graphileJobKey),
    statusIdx: index("supplier_booking_jobs_status_idx").on(table.status),
  }),
);
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
cd backend
npx tsx tests/workflow/booking-job.workflow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Generate Drizzle migration**

Run:

```bash
cd backend
npx drizzle-kit generate
```

Expected: a new SQL migration appears under `backend/src/db/migrations`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrations backend/src/jobs/booking-job.types.ts backend/src/jobs/booking-job.repository.ts backend/tests/workflow/booking-job.workflow.test.ts
git commit -m "feat: add supplier booking job ledger"
```

## Task 3: Add Graphile Queue Adapter

**Files:**
- Create: `backend/src/jobs/booking-queue.ts`
- Create: `backend/tests/unit/booking-queue.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing queue adapter test**

Create `backend/tests/unit/booking-queue.test.ts`:

```ts
import assert from "node:assert/strict";

import { supplierBookingJobKey, supplierBookingTaskName, enqueueSupplierBookingJobWithAddJob } from "../../src/jobs/booking-queue";

const calls: unknown[] = [];

await enqueueSupplierBookingJobWithAddJob(
  async (identifier, payload, spec) => {
    calls.push({ identifier, payload, spec });
    return { id: "graphile-job-id" };
  },
  { bookingId: "11111111-1111-4111-8111-111111111111" }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/booking-queue.test.ts
```

Expected: FAIL because `src/jobs/booking-queue.ts` does not exist.

- [ ] **Step 3: Implement queue adapter**

Create `backend/src/jobs/booking-queue.ts`:

```ts
import type { AddJobFunction } from "graphile-worker";
import { makeWorkerUtils } from "graphile-worker";

import { env } from "../config";
import type { SupplierBookingJobPayload } from "./booking-job.types";

export const supplierBookingTaskName = "supplier-booking";

export function supplierBookingJobKey(bookingId: string): string {
  return `supplier-booking:${bookingId}`;
}

export async function enqueueSupplierBookingJobWithAddJob(
  addJob: AddJobFunction,
  payload: SupplierBookingJobPayload
): Promise<void> {
  await addJob(supplierBookingTaskName, payload, {
    queueName: "supplier-booking",
    maxAttempts: 3,
    jobKey: supplierBookingJobKey(payload.bookingId),
    jobKeyMode: "unsafe_dedupe",
  });
}

export async function enqueueSupplierBookingJob(payload: SupplierBookingJobPayload): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to enqueue supplier booking jobs");
  }

  const workerUtils = await makeWorkerUtils({
    connectionString: env.DATABASE_URL,
  });

  try {
    await enqueueSupplierBookingJobWithAddJob(workerUtils.addJob, payload);
  } finally {
    await workerUtils.release();
  }
}
```

- [ ] **Step 4: Add test script**

Append `&& tsx tests/unit/booking-queue.test.ts` to the `test:unit` script in `backend/package.json`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd backend
npx tsx tests/unit/booking-queue.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/jobs/booking-queue.ts backend/tests/unit/booking-queue.test.ts backend/package.json
git commit -m "feat: add supplier booking queue adapter"
```

## Task 4: Convert Supplier Booking Execution into a Worker Task

**Files:**
- Create: `backend/src/jobs/tasks/supplier-booking.task.ts`
- Modify: `backend/src/jobs/task-list.ts`
- Modify: `backend/src/workflows/booking.workflow.ts`
- Modify: `backend/src/domain/booking/booking.types.ts`
- Modify: `backend/src/domain/booking/booking.repository.ts`
- Test: `backend/tests/workflow/booking.workflow.test.ts`

- [ ] **Step 1: Write failing booking workflow test for queued booking**

In `backend/tests/workflow/booking.workflow.test.ts`, add this test near the existing passenger collection tests:

```ts
const enqueuedBookingIds: string[] = [];

const queuedResult = await collectPassengerDetailsAndQueueSupplierBooking({
  userId: "user-1",
  conversationId: "conversation-1",
  passenger: validPassenger,
  repository,
  jobRepository: {
    async createQueued(input) {
      return {
        id: "job-1",
        bookingId: input.bookingId,
        graphileJobKey: input.graphileJobKey,
        status: "queued",
        attemptCount: 0,
        queuedAt: input.now,
        updatedAt: input.now,
      };
    },
    async markRunning() {
      throw new Error("not used in this test");
    },
    async markSucceeded() {
      throw new Error("not used in this test");
    },
    async markFailed() {
      throw new Error("not used in this test");
    },
  },
  enqueueSupplierBooking: async (payload) => {
    enqueuedBookingIds.push(payload.bookingId);
  },
  now: new Date("2026-05-01T12:00:00.000Z"),
});

assert.equal(queuedResult.kind, "ok");
assert.deepEqual(enqueuedBookingIds, ["booking-1"]);
if (queuedResult.kind === "ok") {
  assert.equal(queuedResult.value.status, "supplier_booking_pending");
  assert.equal(queuedResult.value.bookingId, "booking-1");
}
```

Import the new function at the top:

```ts
import {
  collectPassengerDetailsAndCreateSupplierHold,
  collectPassengerDetailsAndQueueSupplierBooking,
  createBookingFromSelectedOption,
} from "../../src/workflows/booking.workflow";
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/booking.workflow.test.ts
```

Expected: FAIL because `collectPassengerDetailsAndQueueSupplierBooking` does not exist.

- [ ] **Step 3: Add queued result types**

In `backend/src/domain/booking/booking.types.ts`, add:

```ts
import type { SupplierBookingJobRepository, SupplierBookingJobRecord, SupplierBookingJobPayload } from "../../jobs/booking-job.types";
```

Then add:

```ts
export type QueueSupplierBookingInput = {
  userId: string;
  conversationId: string;
  passenger?: Passenger;
  repository?: BookingRepository;
  jobRepository?: SupplierBookingJobRepository;
  enqueueSupplierBooking?: (payload: SupplierBookingJobPayload) => Promise<void>;
  now?: Date;
};

export type QueuedSupplierBooking = {
  bookingId: string;
  status: "supplier_booking_pending";
  job: SupplierBookingJobRecord;
};
```

- [ ] **Step 4: Implement queueing workflow**

In `backend/src/workflows/booking.workflow.ts`, import:

```ts
import { supplierBookingJobKey } from "../jobs/booking-queue";
import type { QueueSupplierBookingInput, QueuedSupplierBooking } from "../domain/booking/booking.types";
```

Add this function below `collectPassengerDetailsAndCreateSupplierHold`:

```ts
export async function collectPassengerDetailsAndQueueSupplierBooking(
  input: QueueSupplierBookingInput
): Promise<WorkflowResult<QueuedSupplierBooking>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "booking repository dependency is required" };
  }
  if (!input.jobRepository) {
    return { kind: "temporary_failure", reason: "supplier booking job repository dependency is required" };
  }
  if (!input.enqueueSupplierBooking) {
    return { kind: "temporary_failure", reason: "supplier booking enqueue dependency is required" };
  }

  const booking = await input.repository.findActiveBookingForPassengerCollection({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  if (!booking) {
    return { kind: "permanent_failure", reason: "no active priced booking found for passenger collection" };
  }

  const passenger = input.passenger ? validatePassenger(input.passenger) : invalidPassenger("Passenger details must be submitted through the WhatsApp Flow.");
  if (!passenger.ok) {
    return {
      kind: "needs_user_input",
      field: "passenger_details",
      ui: {
        type: "text",
        body: passenger.message,
      },
    };
  }

  const collectedAt = input.now ?? new Date();
  await input.repository.collectPassengerDetails({
    bookingId: booking.id,
    userId: input.userId,
    conversationId: input.conversationId,
    passenger: passenger.value,
    supplierContactEmail: booking.bookingEmailAlias,
    collectedAt,
  });

  const job = await input.jobRepository.createQueued({
    bookingId: booking.id,
    graphileJobKey: supplierBookingJobKey(booking.id),
    now: collectedAt,
  });
  await input.enqueueSupplierBooking({ bookingId: booking.id });

  return makeOk({
    bookingId: booking.id,
    status: "supplier_booking_pending",
    job,
  });
}
```

- [ ] **Step 5: Update booking status when passenger details are collected**

In `backend/src/domain/booking/booking.repository.ts`, update the SQL inside `collectPassengerDetails` so the `updated_booking` CTE sets:

```sql
status = 'supplier_booking_pending'
```

instead of:

```sql
status = 'supplier_hold_pending'
```

This status means the worker has not necessarily started browser automation yet.

- [ ] **Step 6: Add worker task**

Create `backend/src/jobs/tasks/supplier-booking.task.ts`:

```ts
import type { Task } from "graphile-worker";

import { db } from "../../db/client";
import { createWakanowBrowserHoldClient } from "../../integrations/wakanow/wakanow.booking";
import { createDrizzleSupplierBookingRepository, handleSupplierHoldResult, recordSupplierHoldDecision } from "../../workflows/supplier-booking.workflow";
import { createDrizzleSupplierBookingJobRepository } from "../booking-job.repository";
import type { SupplierBookingJobPayload } from "../booking-job.types";

export const supplierBookingTask: Task = async (payload) => {
  assertSupplierBookingPayload(payload);

  const jobRepository = createDrizzleSupplierBookingJobRepository(db);
  const now = new Date();
  await jobRepository.markRunning({ bookingId: payload.bookingId, startedAt: now });

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
  if (!payload || typeof payload !== "object") throw new Error("Invalid supplier booking payload");
  const value = payload as Record<string, unknown>;
  if (typeof value.bookingId !== "string" || value.bookingId.length === 0) {
    throw new Error("Invalid supplier booking payload bookingId");
  }
}

function isRetryableSupplierBookingError(message: string): boolean {
  return /timeout|network|browser|navigation|temporar/i.test(message);
}
```

- [ ] **Step 7: Add booking-level supplier client method**

In `backend/src/integrations/wakanow/wakanow.booking.ts`, add this method to `WakanowHoldClient`:

```ts
createHoldForBooking(input: { bookingId: string }): Promise<SupplierHoldResult>;
```

Implement it by loading the booking, selected option, passenger snapshot, and booking alias from Postgres, then calling the existing `createHold` with:

```ts
{
  bookingId,
  selectedFlightOptionId,
  passengerSnapshot,
  contactEmail
}
```

Use existing table names:

```sql
skypadi_whatsapp.bookings
skypadi_whatsapp.booking_passengers
skypadi_whatsapp.booking_email_aliases
```

Throw this exact error when the booking is not ready:

```ts
throw new Error("Booking is not ready for supplier hold");
```

Use this helper in `backend/src/integrations/wakanow/wakanow.booking.ts`:

```ts
async function findReadyBookingForSupplierHold(db: DbClient, bookingId: string): Promise<WakanowHoldRequest> {
  const result = await db.execute(sql`
    select
      b.id,
      b.selected_flight_option_id,
      bp.snapshot,
      bea.email_address
    from skypadi_whatsapp.bookings b
    inner join skypadi_whatsapp.booking_passengers bp
      on bp.booking_id = b.id
      and bp.passenger_type = 'adult'
    inner join skypadi_whatsapp.booking_email_aliases bea
      on bea.booking_id = b.id
      and bea.status = 'active'
    where b.id = ${bookingId}
      and b.status = 'supplier_booking_pending'
    order by bp.created_at asc
    limit 1
  `);

  const row = result.rows[0] as
    | {
        id: string;
        selected_flight_option_id: string | null;
        snapshot: Record<string, unknown>;
        email_address: string;
      }
    | undefined;

  if (!row?.selected_flight_option_id) {
    throw new Error("Booking is not ready for supplier hold");
  }

  return {
    bookingId: row.id,
    selectedFlightOptionId: row.selected_flight_option_id,
    passengerSnapshot: row.snapshot,
    contactEmail: row.email_address,
  };
}
```

Then update `createWakanowBrowserHoldClient`:

```ts
export function createWakanowBrowserHoldClient(input: { db: DbClient }): WakanowHoldClient {
  return {
    async createHold(request) {
      const option = await findWakanowOption(input.db, request.selectedFlightOptionId);
      const passenger = passengerFromSnapshot(request.passengerSnapshot, request.contactEmail);
      const result = await bookFlightApi({
        bookingId: request.bookingId,
        searchKey: option.searchKey,
        flightId: option.flightId,
        deeplink: option.deeplink,
        passenger,
        resolveOtp: async () => waitForInboundEmailOtp({
          bookingId: request.bookingId,
          repository: createDrizzleInboundEmailRepository(input.db),
        }),
      });

      return {
        kind: "hold_created",
        supplier: "wakanow",
        supplierBookingRef: result.bookingId,
        expiresAt: holdExpiryFromBankTransfer(result.bankTransfers?.[0]?.expiresIn),
        amountDue: result.flightSummary.price,
        currency: "NGN",
        paymentUrl: result.paymentUrl,
        rawStatus: result.status,
      };
    },
    async createHoldForBooking(request) {
      return this.createHold(await findReadyBookingForSupplierHold(input.db, request.bookingId));
    },
  };
}
```

- [ ] **Step 8: Register task**

Modify `backend/src/jobs/task-list.ts`:

```ts
import type { TaskList } from "graphile-worker";

import { supplierBookingTask } from "./tasks/supplier-booking.task";
import { supplierBookingTaskName } from "./booking-queue";

export const taskList: TaskList = {
  [supplierBookingTaskName]: supplierBookingTask,
};
```

- [ ] **Step 9: Run tests**

Run:

```bash
cd backend
npx tsx tests/workflow/booking.workflow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/domain/booking backend/src/workflows/booking.workflow.ts backend/src/integrations/wakanow/wakanow.booking.ts backend/src/jobs backend/tests/workflow/booking.workflow.test.ts
git commit -m "feat: queue supplier booking jobs"
```

## Task 5: Add Minimal Tool-Based Chat Agent

**Files:**
- Create: `backend/src/tools/chat-tool.types.ts`
- Create: `backend/src/tools/chat-agent.ts`
- Create: `backend/tests/unit/chat-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing chat agent tests**

Create `backend/tests/unit/chat-agent.test.ts`:

```ts
import assert from "node:assert/strict";

import { decideChatActionWithModel } from "../../src/tools/chat-agent";

const searchDecision = await decideChatActionWithModel(
  async () => ({
    type: "tool",
    tool: "searchFlights",
    input: {
      origin: "LOS",
      destination: "ENU",
      departureDate: "2026-05-09",
      adults: 1,
    },
  }),
  {
    userText: "Find Lagos to Enugu next Saturday",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
);

assert.equal(searchDecision.type, "tool");
if (searchDecision.type === "tool") {
  assert.equal(searchDecision.tool, "searchFlights");
  assert.equal(searchDecision.input.destination, "ENU");
}

const replyDecision = await decideChatActionWithModel(
  async () => ({
    type: "reply",
    message: "Sure. Which city are you flying from?",
  }),
  {
    userText: "I want to travel",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
);

assert.deepEqual(replyDecision, {
  type: "reply",
  message: "Sure. Which city are you flying from?",
});

const longReply = await decideChatActionWithModel(
  async () => ({
    type: "reply",
    message: "A. B. C. D.",
  }),
  {
    userText: "Explain everything",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
);

assert.equal(longReply.type, "reply");
if (longReply.type === "reply") {
  assert.equal(longReply.message, "A. B. C.");
}

console.log("chat agent tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/chat-agent.test.ts
```

Expected: FAIL because `src/tools/chat-agent.ts` does not exist.

- [ ] **Step 3: Add tool contracts**

Create `backend/src/tools/chat-tool.types.ts`:

```ts
export type ChatContext = {
  conversationId: string;
  userId: string;
  phoneNumber: string;
  latestBookingStatus?: string;
};

export type SearchFlightsToolInput = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
};

export type StartBookingJobToolInput = {
  selectedFlightOptionId: string;
};

export type ChatToolRequest =
  | {
      type: "tool";
      tool: "searchFlights";
      input: SearchFlightsToolInput;
    }
  | {
      type: "tool";
      tool: "startBookingJob";
      input: StartBookingJobToolInput;
    };

export type ChatReply = {
  type: "reply";
  message: string;
};

export type ChatAction = ChatReply | ChatToolRequest;

export type DecideChatActionInput = {
  userText: string;
  now: Date;
  context: ChatContext;
};
```

- [ ] **Step 4: Implement model-independent chat decision validation**

Create `backend/src/tools/chat-agent.ts`:

```ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import type { ChatAction, DecideChatActionInput } from "./chat-tool.types";

const chatActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reply"),
    message: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("tool"),
    tool: z.literal("searchFlights"),
    input: z.object({
      origin: z.string().trim().min(2),
      destination: z.string().trim().min(2),
      departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      adults: z.number().int().positive().default(1),
    }),
  }),
  z.object({
    type: z.literal("tool"),
    tool: z.literal("startBookingJob"),
    input: z.object({
      selectedFlightOptionId: z.string().uuid(),
    }),
  }),
]);

export type ChatModel = (input: DecideChatActionInput) => Promise<unknown>;

export async function decideChatActionWithModel(model: ChatModel, input: DecideChatActionInput): Promise<ChatAction> {
  const parsed = chatActionSchema.parse(await model(input));
  if (parsed.type === "reply") {
    return { type: "reply", message: trimToThreeSentences(parsed.message) };
  }
  return parsed;
}

export function createOpenAIChatModel(input: { apiKey: string; model: string }): ChatModel {
  const openai = createOpenAI({ apiKey: input.apiKey });
  return async (decisionInput) => {
    const result = await generateObject({
      model: openai.chat(input.model),
      schema: chatActionSchema,
      prompt: buildPrompt(decisionInput),
    });
    return result.object;
  };
}

function buildPrompt(input: DecideChatActionInput): string {
  return [
    "You are Skypadi, a WhatsApp flight booking assistant.",
    "Reply in at most three short sentences.",
    "Ask one question when required information is missing.",
    "Use searchFlights only when origin, destination, departure date, and adult count are known.",
    "Use startBookingJob only when the user clearly selected a flight option by ID already shown by the app.",
    "Do not call booking tools for side questions.",
    `Current date: ${input.now.toISOString().slice(0, 10)}`,
    `Context: ${JSON.stringify(input.context)}`,
    `User message: ${input.userText}`,
  ].join("\n");
}

function trimToThreeSentences(message: string): string {
  const sentences = message
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 3).join(" ");
}
```

- [ ] **Step 5: Add test script**

Append `&& tsx tests/unit/chat-agent.test.ts` to `test:unit` in `backend/package.json`.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend
npx tsx tests/unit/chat-agent.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tools/chat-tool.types.ts backend/src/tools/chat-agent.ts backend/tests/unit/chat-agent.test.ts backend/package.json
git commit -m "feat: add minimal chat tool router"
```

## Task 6: Add Search and Booking Tools

**Files:**
- Create: `backend/src/tools/search-flights.tool.ts`
- Create: `backend/src/tools/start-booking-job.tool.ts`
- Modify: `backend/tests/workflow/booking.workflow.test.ts`
- Test: `backend/tests/unit/chat-tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `backend/tests/unit/chat-tools.test.ts`:

```ts
import assert from "node:assert/strict";

import { executeSearchFlightsTool } from "../../src/tools/search-flights.tool";
import { executeStartBookingJobTool } from "../../src/tools/start-booking-job.tool";

const searchIntent = await executeSearchFlightsTool({
  userId: "user-1",
  conversationId: "conversation-1",
  phoneNumber: "2348012345678",
  input: {
    origin: "LOS",
    destination: "ENU",
    departureDate: "2026-05-09",
    adults: 1,
  },
  flightSearchHandler: {
    async searchAndPresent(input) {
      assert.equal(input.search.destination, "ENU");
      return {
        type: "text",
        body: "Found flights to Enugu.",
      };
    },
  },
});

assert.deepEqual(searchIntent, {
  type: "text",
  body: "Found flights to Enugu.",
});

const bookingIntent = await executeStartBookingJobTool({
  conversationId: "conversation-1",
  userId: "user-1",
  phoneNumber: "2348012345678",
  input: {
    selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
  },
  createBookingFromSelectedOption: async () => ({
    kind: "ok",
    value: {
      id: "booking-1",
      userId: "user-1",
      conversationId: "conversation-1",
      selectedFlightOptionId: "22222222-2222-4222-8222-222222222222",
      status: "priced",
      bookingEmailAlias: "book-abc@example.com",
      createdAt: new Date("2026-05-01T09:00:00.000Z"),
    },
  }),
  passengerDetailsFlowId: "flow-1",
});

assert.equal(bookingIntent.type, "passenger_details_flow");

console.log("chat tool tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/chat-tools.test.ts
```

Expected: FAIL because the tool files do not exist.

- [ ] **Step 3: Implement search tool**

Create `backend/src/tools/search-flights.tool.ts`:

```ts
import type { FlightSearchHandler } from "../channels/whatsapp/whatsapp.routes";
import type { UiIntent } from "../channels/whatsapp/whatsapp.types";
import type { SearchFlightsToolInput } from "./chat-tool.types";

export async function executeSearchFlightsTool(input: {
  userId: string;
  conversationId: string;
  phoneNumber: string;
  input: SearchFlightsToolInput;
  flightSearchHandler: FlightSearchHandler;
}): Promise<UiIntent> {
  return input.flightSearchHandler.searchAndPresent({
    userId: input.userId,
    conversationId: input.conversationId,
    phoneNumber: input.phoneNumber,
    search: {
      origin: input.input.origin,
      destination: input.input.destination,
      departureDate: input.input.departureDate,
      departureWindow: "anytime",
      tripType: input.input.returnDate ? "return" : "one_way",
      returnDate: input.input.returnDate,
      adults: input.input.adults,
    },
  });
}
```

- [ ] **Step 4: Implement start booking tool**

Create `backend/src/tools/start-booking-job.tool.ts`:

```ts
import type { UiIntent } from "../channels/whatsapp/whatsapp.types";
import type { BookingDraft } from "../domain/booking/booking.types";
import type { WorkflowResult } from "../workflows/workflow-result";
import type { StartBookingJobToolInput } from "./chat-tool.types";

export async function executeStartBookingJobTool(input: {
  userId: string;
  conversationId: string;
  phoneNumber: string;
  input: StartBookingJobToolInput;
  passengerDetailsFlowId: string;
  createBookingFromSelectedOption: (input: {
    userId: string;
    conversationId: string;
    selectedFlightOptionId: string;
    inboundDomain: string;
  }) => Promise<WorkflowResult<BookingDraft>>;
  inboundDomain?: string;
}): Promise<UiIntent> {
  const result = await input.createBookingFromSelectedOption({
    userId: input.userId,
    conversationId: input.conversationId,
    selectedFlightOptionId: input.input.selectedFlightOptionId,
    inboundDomain: input.inboundDomain ?? "booking.local",
  });

  if (result.kind !== "ok") {
    return { type: "text", body: "I could not start that booking. Please choose another flight." };
  }

  return {
    type: "passenger_details_flow",
    body: "Great choice. Please enter the passenger details.",
    buttonText: "Enter details",
    flowId: input.passengerDetailsFlowId,
    flowToken: result.value.id,
    data: {
      bookingId: result.value.id,
      selectedFlightOptionId: result.value.selectedFlightOptionId,
    },
  };
}
```

- [ ] **Step 5: Add test script**

Append `&& tsx tests/unit/chat-tools.test.ts` to `test:unit` in `backend/package.json`.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend
npx tsx tests/unit/chat-tools.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tools/search-flights.tool.ts backend/src/tools/start-booking-job.tool.ts backend/tests/unit/chat-tools.test.ts backend/package.json
git commit -m "feat: add chat flight and booking tools"
```

## Task 7: Replace WhatsApp Workflow Route with Tool Route

**Files:**
- Create: `backend/src/channels/whatsapp/whatsapp.tool-routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/tests/integration/whatsapp.routes.test.ts`
- Create: `backend/tests/integration/whatsapp.tool-routes.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `backend/tests/integration/whatsapp.tool-routes.test.ts`:

```ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildServer } from "../../src/app";
import type { ChatModel } from "../../src/tools/chat-agent";

const sentMessages: unknown[] = [];

const chatModel: ChatModel = async () => ({
  type: "reply",
  message: "Sure. Where are you flying from?",
});

const app = buildServer({
  whatsappVerifyToken: "verify-token",
  whatsappAppSecret: "secret",
  whatsappClient: {
    async sendMessage(input) {
      sentMessages.push(input);
      return { providerMessageId: "sent-1" };
    },
  },
  chatModel,
});

const body = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: "wamid.tool.1",
                from: "2348012345678",
                timestamp: "1777620000",
                type: "text",
                text: { body: "I want to travel" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
const response = await app.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: body,
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": signature,
  },
});

assert.equal(response.statusCode, 200);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(sentMessages.length, 1);

await app.close();
console.log("whatsapp tool route tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/integration/whatsapp.tool-routes.test.ts
```

Expected: FAIL because `BuildServerOptions` does not accept `chatModel` and the route still uses the workflow handler.

- [ ] **Step 3: Implement tool route**

Create `backend/src/channels/whatsapp/whatsapp.tool-routes.ts` by copying the webhook verification, message extraction, signature validation, passenger flow parsing, and duplicate message persistence from `whatsapp.routes.ts`. Replace the conversation workflow call with:

```ts
const action = await decideChatActionWithModel(options.chatModel, {
  userText: message.text?.body ?? "",
  now,
  context: {
    conversationId: conversation.id,
    userId: conversation.userId,
    phoneNumber: message.from,
  },
});

const intent = await uiIntentFromChatAction(action, {
  conversation,
  message,
  options,
});
```

Define route options:

```ts
export type WhatsAppToolRoutesOptions = {
  verifyToken: string;
  conversationRepository: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient: WhatsAppClient;
  appSecret?: string;
  chatModel: ChatModel;
  flightSearchHandler: FlightSearchHandler;
  bookingHandler: BookingSelectionHandler;
};
```

Define `uiIntentFromChatAction`:

```ts
async function uiIntentFromChatAction(
  action: ChatAction,
  input: {
    conversation: PersistedInboundMessage["conversation"];
    message: WhatsAppInboundMessage;
    options: WhatsAppToolRoutesOptions;
  }
): Promise<UiIntent | undefined> {
  if (!input.conversation.userId) {
    throw new Error("Persisted WhatsApp conversation is missing userId");
  }

  if (action.type === "reply") {
    return { type: "text", body: action.message };
  }

  if (action.tool === "searchFlights") {
    return executeSearchFlightsTool({
      userId: input.conversation.userId,
      conversationId: input.conversation.id,
      phoneNumber: input.message.from,
      input: action.input,
      flightSearchHandler: input.options.flightSearchHandler,
    });
  }

  return input.options.bookingHandler.createFromFlightSelection({
    userId: input.conversation.userId,
    conversationId: input.conversation.id,
    phoneNumber: input.message.from,
    selectedFlightOptionId: action.input.selectedFlightOptionId,
  });
}
```

- [ ] **Step 4: Wire app to tool route**

In `backend/src/app.ts`, replace:

```ts
import { registerWhatsAppWorkflowRoutes } from "./channels/whatsapp/whatsapp.routes";
```

with:

```ts
import { registerWhatsAppToolRoutes } from "./channels/whatsapp/whatsapp.tool-routes";
```

Add to `BuildServerOptions`:

```ts
chatModel?: ChatModel;
```

Use:

```ts
chatModel: options.chatModel ?? createOpenAIChatModel({
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_INTENT_MODEL,
}),
```

Pass that into `registerWhatsAppToolRoutes`.

- [ ] **Step 5: Keep passenger details async**

In `createLiveBookingHandler`, replace the `collectPassengerDetails` implementation so it calls `collectPassengerDetailsAndQueueSupplierBooking` with:

```ts
jobRepository: createDrizzleSupplierBookingJobRepository(db),
enqueueSupplierBooking: enqueueSupplierBookingJob,
```

Return this message on success:

```ts
{
  type: "text",
  body: "Booking started. I’ll update you shortly.",
}
```

- [ ] **Step 6: Update integration test script**

Append `&& tsx tests/integration/whatsapp.tool-routes.test.ts` to `test:integration` in `backend/package.json`.

- [ ] **Step 7: Run integration tests**

Run:

```bash
cd backend
npx tsx tests/integration/whatsapp.tool-routes.test.ts
npm run test:integration
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/channels/whatsapp/whatsapp.tool-routes.ts backend/src/app.ts backend/tests/integration/whatsapp.tool-routes.test.ts backend/package.json
git commit -m "feat: route whatsapp through chat tools"
```

## Task 8: Send WhatsApp Updates from Booking Job

**Files:**
- Create: `backend/src/jobs/booking-job-notifier.ts`
- Modify: `backend/src/jobs/tasks/supplier-booking.task.ts`
- Test: `backend/tests/unit/booking-job-notifier.test.ts`

- [ ] **Step 1: Write failing notifier test**

Create `backend/tests/unit/booking-job-notifier.test.ts`:

```ts
import assert from "node:assert/strict";

import { supplierDecisionMessage } from "../../src/jobs/booking-job-notifier";

assert.equal(
  supplierDecisionMessage({
    bookingId: "booking-1",
    status: "awaiting_payment_for_hold",
    policy: "hold_first",
    supplier: "wakanow",
    supplierBookingRef: "WK123",
    holdExpiresAt: new Date("2026-05-01T16:00:00.000Z"),
    amountDue: 120000,
    currency: "NGN",
    holdMode: "hold_created",
    rawStatus: "hold_created",
  }),
  "Hold created. Ref: WK123. Please pay before 5:00 PM."
);

assert.equal(
  supplierDecisionMessage({
    bookingId: "booking-1",
    status: "payment_pending",
    policy: "payment_first",
    supplier: "wakanow",
    amountDue: 120000,
    currency: "NGN",
    holdMode: "instant_purchase_required",
    rawStatus: "instant_purchase_required",
  }),
  "This fare needs payment before ticketing. I saved the booking."
);

assert.equal(
  supplierDecisionMessage({
    bookingId: "booking-1",
    status: "manual_review_required",
    policy: "manual_review",
    supplier: "wakanow",
    holdMode: "unclear",
    rawStatus: "unclear",
    reason: "browser timeout",
  }),
  "I could not finish this automatically. I moved it to manual review."
);

console.log("booking job notifier tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/booking-job-notifier.test.ts
```

Expected: FAIL because `src/jobs/booking-job-notifier.ts` does not exist.

- [ ] **Step 3: Implement notifier text**

Create `backend/src/jobs/booking-job-notifier.ts`:

```ts
import type { SupplierHoldDecision } from "../workflows/supplier-booking.workflow";

export function supplierDecisionMessage(decision: SupplierHoldDecision): string {
  if (decision.status === "awaiting_payment_for_hold") {
    const ref = decision.supplierBookingRef ? ` Ref: ${decision.supplierBookingRef}.` : "";
    const expiry = decision.holdExpiresAt
      ? ` Please pay before ${decision.holdExpiresAt.toLocaleTimeString("en-NG", {
          timeZone: "Africa/Lagos",
          hour: "numeric",
          minute: "2-digit",
        })}.`
      : " Please pay before the hold expires.";
    return `Hold created.${ref}${expiry}`;
  }

  if (decision.status === "payment_pending") {
    return "This fare needs payment before ticketing. I saved the booking.";
  }

  return "I could not finish this automatically. I moved it to manual review.";
}
```

- [ ] **Step 4: Send update from worker**

In `backend/src/jobs/tasks/supplier-booking.task.ts`, after `recordSupplierHoldDecision`, send WhatsApp text:

```ts
const message = supplierDecisionMessage(decision);
await whatsappClient.sendMessage({
  to: phoneNumber,
  message: {
    type: "text",
    body: message,
  },
});
```

Load `phoneNumber` by joining `bookings -> conversations -> whatsapp_contacts`. Use `createWhatsAppCloudClient` with `env.WHATSAPP_ACCESS_TOKEN` and `env.WHATSAPP_PHONE_NUMBER_ID`.

- [ ] **Step 5: Add test script**

Append `&& tsx tests/unit/booking-job-notifier.test.ts` to `test:unit` in `backend/package.json`.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend
npx tsx tests/unit/booking-job-notifier.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/jobs/booking-job-notifier.ts backend/src/jobs/tasks/supplier-booking.task.ts backend/tests/unit/booking-job-notifier.test.ts backend/package.json
git commit -m "feat: notify whatsapp from booking jobs"
```

## Task 9: Final Verification and Operational Notes

**Files:**
- Modify: `backend/README.md`
- Modify: `backend/.env.example`

- [ ] **Step 1: Document worker commands**

Add to `backend/README.md`:

````md
## Worker

The web process handles HTTP and WhatsApp webhooks:

```bash
npm run start
```

The worker process handles durable supplier booking jobs:

```bash
npm run start:worker
```

Graphile Worker creates and updates its internal schema when the worker starts with a valid `DATABASE_URL`.

Set `WORKER_CONCURRENCY=1` for browser booking automation until we have production timing data.
````

- [ ] **Step 2: Document env**

Add to `backend/.env.example`:

```dotenv
WORKER_CONCURRENCY=1
```

- [ ] **Step 3: Smoke-check worker startup locally against a configured database**

Run only when `DATABASE_URL` points to a safe development database:

```bash
cd backend
node --input-type=module -e 'import { run } from "graphile-worker"; const runner = await run({ connectionString: process.env.DATABASE_URL, taskList: {}, concurrency: 1 }); await runner.stop();'
```

Expected: the worker starts, creates/updates Graphile Worker tables if needed, and exits 0.

- [ ] **Step 4: Run full verification**

Run:

```bash
cd backend
npm run verify
```

Expected: PASS.

- [ ] **Step 5: Verify bundles**

Run:

```bash
cd backend
test -f dist/index.js
test -f dist/worker.js
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/README.md backend/.env.example
git commit -m "docs: document booking worker operations"
```

## Self-Review

- Spec coverage: The plan covers minimal tool-based chat, synchronous flight search, asynchronous booking jobs, Graphile Worker runtime, app-owned job state, WhatsApp updates, build scripts, tests, and operational docs.
- Placeholder scan: The plan contains concrete file paths, commands, and code blocks for each implementation step.
- Type consistency: `SupplierBookingJobPayload`, `SupplierBookingJobRepository`, `ChatAction`, `SearchFlightsToolInput`, `StartBookingJobToolInput`, and `QueuedSupplierBooking` are introduced before use in later tasks.

## References

- Graphile Worker docs: https://worker.graphile.org/docs
- Graphile Worker `addJob` API: https://worker.graphile.org/docs/library/add-job
- Graphile Worker TypeScript payload safety: https://worker.graphile.org/docs/typescript
- Graphile Worker schema setup: https://worker.graphile.org/docs/cli/run
