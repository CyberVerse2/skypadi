# WhatsApp Backend Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Skypadi backend internals as a WhatsApp-only, workflow-driven travel booking system with clean Drizzle/Postgres persistence, Resend inbound aliases, Wakanow hold-first/payment-first supplier fulfillment, and deterministic state transitions.

**Architecture:** Channels normalize provider payloads into internal events. Workflows own decisions and state transitions. Domain repositories own persistence. Integrations own Wakanow, Resend, WhatsApp, and payment provider details. The AI layer extracts and writes language but never performs irreversible actions.

**Tech Stack:** TypeScript ESM, Fastify, Drizzle ORM + Drizzle Kit, Postgres, WhatsApp Cloud API, Resend inbound email, Wakanow integration, `tsx` tests, `tsc` typechecking.

---

## Source Specs

- `docs/superpowers/specs/2026-04-29-whatsapp-backend-rewrite-design.md`
- `docs/superpowers/specs/2026-04-29-whatsapp-conversation-ui-design.md`

## Scope Decisions

- Remove Telegram entirely.
- Remove AgentMail entirely.
- Do not preserve old database schema compatibility.
- Use Drizzle as the DB interface.
- Use Drizzle raw SQL for flight option lookup/ranking and exact transactional state transitions.
- Use direct `pg` only as a documented escape hatch.
- Ship bank transfer confirmation first. Keep the `card` payment method type and workflow branch, but return a typed `needs_manual_review` result until a card provider is selected.
- Manual review actions are backend-only in this plan. Admin dashboard UI is out of scope.

## Target File Map

```text
backend/
  drizzle.config.ts
  package.json
  tsconfig.json
  tsconfig.test.json
  src/
    app.ts
    index.ts
    config/
      env.ts
      logger.ts
    db/
      pool.ts
      client.ts
      migrate.ts
      schema.ts
      repositories/
    agent/
      agent.client.ts
      intent-extractor.ts
      response-writer.ts
      prompts.ts
    channels/
      whatsapp/
        whatsapp.routes.ts
        whatsapp.client.ts
        whatsapp.mapper.ts
        whatsapp.types.ts
    domain/
      audit/
        audit.types.ts
        audit.repository.ts
      booking/
        booking.types.ts
        booking.repository.ts
        booking.service.ts
      conversation/
        conversation.types.ts
        conversation.repository.ts
        conversation.service.ts
      flight/
        flight.types.ts
        flight.repository.ts
        flight-search.service.ts
      inbound-email/
        inbound-email.types.ts
        inbound-email.repository.ts
        inbound-email.service.ts
      passenger/
        passenger.types.ts
        passenger.repository.ts
        passenger.service.ts
      payment/
        payment.types.ts
        payment.repository.ts
        payment.service.ts
    integrations/
      resend/
        resend.client.ts
        resend.webhook-verifier.ts
        booking-alias.service.ts
      wakanow/
        wakanow.client.ts
        wakanow.search.ts
        wakanow.booking.ts
        wakanow.types.ts
      payments/
        bank-transfer.ts
        card.ts
    workflows/
      workflow-result.ts
      conversation.workflow.ts
      flight-search.workflow.ts
      booking.workflow.ts
      payment.workflow.ts
      supplier-booking.workflow.ts
      inbound-email.workflow.ts
      notification.workflow.ts
  tests/
    unit/
    workflow/
    integration/
```

---

## Task 1: Baseline Test Harness And Scripts

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.test.json`
- Create: `backend/tests/test-helpers/assert.ts`

- [ ] **Step 1: Write failing test helper smoke test**

Create `backend/tests/unit/test-harness.test.ts`:

```ts
import assert from "node:assert/strict";

import { assertOk } from "../test-helpers/assert.js";

assertOk({ ok: true, value: "ready" });
assert.throws(() => assertOk({ ok: false, error: "nope" }), /Expected ok result/);
console.log("test harness tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/test-harness.test.ts
```

Expected: FAIL with module not found for `../test-helpers/assert.js`.

- [ ] **Step 3: Add helper implementation**

Create `backend/tests/test-helpers/assert.ts`:

```ts
export type TestResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function assertOk<T>(result: TestResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got error: ${result.error}`);
  }

  return result.value;
}
```

Modify `backend/package.json` scripts:

```json
{
  "test:unit": "tsx tests/unit/test-harness.test.ts",
  "test:workflow": "tsx tests/workflow/conversation.workflow.test.ts",
  "test:integration": "tsx tests/integration/whatsapp.routes.test.ts",
  "test:all": "npm run test:unit && npm run test:workflow && npm run test:integration && npm run typecheck:test"
}
```

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npm run test:unit
npm run typecheck:test
```

Expected: helper test passes and test typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/tsconfig.test.json backend/tests
git commit -m "test: add backend rewrite test harness"
```

---

## Task 2: Drizzle Foundation And Clean Schema

**Files:**
- Modify: `backend/package.json`
- Create: `backend/drizzle.config.ts`
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/pool.ts`
- Create: `backend/src/db/client.ts`
- Create: `backend/src/db/migrate.ts`
- Test: `backend/tests/unit/schema.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `backend/tests/unit/schema.test.ts`:

```ts
import assert from "node:assert/strict";

import {
  auditEvents,
  bookingEmailAliases,
  bookings,
  conversationMessages,
  conversations,
  flightOptions,
  flightSearches,
  inboundEmails,
  passengers,
  paymentAttempts,
  supplierEvents,
  users,
  whatsappContacts,
} from "../../src/db/schema.js";

const tables = [
  users,
  whatsappContacts,
  conversations,
  conversationMessages,
  passengers,
  flightSearches,
  flightOptions,
  bookings,
  paymentAttempts,
  bookingEmailAliases,
  inboundEmails,
  supplierEvents,
  auditEvents,
];

assert.equal(tables.length, 13);
assert.equal(bookings.status.enumValues.includes("awaiting_payment_for_hold"), true);
assert.equal(paymentAttempts.status.enumValues.includes("proof_uploaded"), true);
assert.equal(inboundEmails.classification.enumValues.includes("verification_code"), true);
console.log("schema tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/schema.test.ts
```

Expected: FAIL because `src/db/schema.ts` does not export Drizzle tables.

- [ ] **Step 3: Install Drizzle dependencies**

Run:

```bash
cd backend
npm install drizzle-orm
npm install -D drizzle-kit
```

- [ ] **Step 4: Implement schema and DB client**

Create `backend/src/db/schema.ts` with Postgres enums and tables for:

```text
users
whatsapp_contacts
conversations
conversation_messages
user_preferences
passengers
flight_searches
flight_options
bookings
booking_passengers
payment_attempts
booking_email_aliases
inbound_emails
supplier_events
audit_events
```

Required enum values:

```ts
export const bookingStatusEnum = pgEnum("booking_status", [
  "draft",
  "priced",
  "passenger_details_collected",
  "payment_pending",
  "payment_confirmed",
  "supplier_hold_pending",
  "supplier_hold_created",
  "awaiting_payment_for_hold",
  "supplier_booking_pending",
  "supplier_verification_required",
  "issued",
  "hold_expired",
  "failed",
  "cancelled",
  "manual_review_required",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "proof_uploaded",
  "confirmed",
  "failed",
  "expired",
  "refunded",
  "manual_review_required",
]);

export const inboundEmailClassificationEnum = pgEnum("inbound_email_classification", [
  "verification_code",
  "booking_confirmation",
  "payment_or_receipt",
  "supplier_change",
  "other",
]);
```

Use unique constraints/indexes for:

```text
whatsapp_contacts.phone_number
conversation_messages.provider_message_id
booking_email_aliases.email_address
inbound_emails.resend_email_id
payment_attempts.provider_reference
```

Create `backend/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
```

Create `backend/src/db/pool.ts`:

```ts
import pg from "pg";

import { config } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});
```

Create `backend/src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";

import { pool } from "./pool.js";
import * as schema from "./schema.js";

export const db = drizzle(pool, { schema });
```

- [ ] **Step 5: Verify green and generate migration**

Run:

```bash
cd backend
npx tsx tests/unit/schema.test.ts
npx drizzle-kit generate
npm run typecheck
```

Expected: schema test passes, a SQL migration is created under `backend/src/db/migrations`, and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/drizzle.config.ts backend/src/db backend/tests/unit/schema.test.ts
git commit -m "feat: add drizzle schema foundation"
```

---

## Task 3: Domain Types And Workflow Result Contracts

**Files:**
- Create: `backend/src/workflows/workflow-result.ts`
- Create: `backend/src/domain/booking/booking.types.ts`
- Create: `backend/src/domain/conversation/conversation.types.ts`
- Create: `backend/src/domain/flight/flight.types.ts`
- Create: `backend/src/domain/payment/payment.types.ts`
- Create: `backend/src/domain/inbound-email/inbound-email.types.ts`
- Test: `backend/tests/unit/domain-types.test.ts`

- [ ] **Step 1: Write failing type/behavior test**

Create `backend/tests/unit/domain-types.test.ts`:

```ts
import assert from "node:assert/strict";

import { isTerminalBookingStatus } from "../../src/domain/booking/booking.types.js";
import { makeNeedsUserInput, makeOk } from "../../src/workflows/workflow-result.js";

assert.equal(isTerminalBookingStatus("issued"), true);
assert.equal(isTerminalBookingStatus("hold_expired"), true);
assert.equal(isTerminalBookingStatus("payment_pending"), false);

assert.deepEqual(makeOk({ message: "ready" }), {
  kind: "ok",
  value: { message: "ready" },
});

assert.deepEqual(makeNeedsUserInput("origin", { type: "origin_list" }), {
  kind: "needs_user_input",
  field: "origin",
  ui: { type: "origin_list" },
});

console.log("domain type tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/domain-types.test.ts
```

Expected: FAIL because domain type modules do not exist.

- [ ] **Step 3: Implement minimal types**

Create `backend/src/workflows/workflow-result.ts`:

```ts
export type WorkflowResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "needs_user_input"; field: string; ui: unknown }
  | { kind: "needs_manual_review"; reason: string }
  | { kind: "temporary_failure"; reason: string }
  | { kind: "permanent_failure"; reason: string };

export function makeOk<T>(value: T): WorkflowResult<T> {
  return { kind: "ok", value };
}

export function makeNeedsUserInput(field: string, ui: unknown): WorkflowResult<never> {
  return { kind: "needs_user_input", field, ui };
}
```

Create booking status and helper in `booking.types.ts` using the status values from the spec. Create minimal exported types for conversation, flight, payment, and inbound email so later tasks can import stable contracts.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/unit/domain-types.test.ts
npm run typecheck
```

Expected: tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain backend/src/workflows/workflow-result.ts backend/tests/unit/domain-types.test.ts
git commit -m "feat: add domain workflow contracts"
```

---

## Task 4: WhatsApp UI Intent Mapping

**Files:**
- Create: `backend/src/channels/whatsapp/whatsapp.types.ts`
- Create: `backend/src/channels/whatsapp/whatsapp.mapper.ts`
- Test: `backend/tests/unit/whatsapp.mapper.test.ts`

- [ ] **Step 1: Write failing mapper test**

Create `backend/tests/unit/whatsapp.mapper.test.ts`:

```ts
import assert from "node:assert/strict";

import { mapUiIntentToWhatsAppMessage } from "../../src/channels/whatsapp/whatsapp.mapper.js";

const originList = mapUiIntentToWhatsAppMessage({
  type: "origin_list",
  body: "Sure. Where are you flying from?",
  rows: [
    { id: "origin:LOS", title: "Lagos", description: "Murtala Muhammed Airport" },
    { id: "origin:ABV", title: "Abuja", description: "Nnamdi Azikiwe Airport" },
  ],
});

assert.equal(originList.type, "interactive");
assert.equal(originList.interactive.type, "list");
assert.equal(originList.interactive.action.sections[0].rows[0].id, "origin:LOS");

const tripButtons = mapUiIntentToWhatsAppMessage({
  type: "reply_buttons",
  body: "Is this one-way or return?",
  buttons: [
    { id: "trip_type:one_way", title: "One-way" },
    { id: "trip_type:return", title: "Return" },
  ],
});

assert.equal(tripButtons.interactive.type, "button");
assert.equal(tripButtons.interactive.action.buttons[1].reply.id, "trip_type:return");
console.log("whatsapp mapper tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/whatsapp.mapper.test.ts
```

Expected: FAIL because mapper module does not exist.

- [ ] **Step 3: Implement mapper**

Create `whatsapp.types.ts` with UI intent types:

```ts
export type UiIntent =
  | {
      type: "origin_list";
      body: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }
  | {
      type: "reply_buttons";
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      type: "text";
      body: string;
    }
  | {
      type: "document";
      body: string;
      documentUrl: string;
      filename: string;
    };
```

Create `whatsapp.mapper.ts` to convert UI intents into WhatsApp Cloud API payload fragments. Enforce max three reply buttons and max ten list rows.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/unit/whatsapp.mapper.test.ts
npm run typecheck
```

Expected: mapper test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/channels/whatsapp backend/tests/unit/whatsapp.mapper.test.ts
git commit -m "feat: map workflow ui intents to whatsapp payloads"
```

---

## Task 5: Conversation Workflow First-Time Flow

**Files:**
- Create: `backend/src/workflows/conversation.workflow.ts`
- Create: `backend/src/domain/conversation/conversation.service.ts`
- Test: `backend/tests/workflow/conversation.workflow.test.ts`

- [ ] **Step 1: Write failing workflow test**

Create `backend/tests/workflow/conversation.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import { handleConversationEvent } from "../../src/workflows/conversation.workflow.js";

const firstMessage = await handleConversationEvent({
  type: "inbound_text",
  contact: { phoneNumber: "2348012345678" },
  text: "I need a flight to Abuja tomorrow morning",
  providerMessageId: "wamid.1",
  now: new Date("2026-04-29T08:00:00.000Z"),
});

assert.equal(firstMessage.kind, "needs_user_input");
assert.equal(firstMessage.field, "origin");
assert.equal((firstMessage.ui as { type: string }).type, "origin_list");

const originSelected = await handleConversationEvent({
  type: "interactive_reply",
  contact: { phoneNumber: "2348012345678" },
  replyId: "origin:LOS",
  providerMessageId: "wamid.2",
  now: new Date("2026-04-29T08:01:00.000Z"),
});

assert.equal(originSelected.kind, "needs_user_input");
assert.equal(originSelected.field, "trip_type");
assert.deepEqual((originSelected.ui as { buttons: Array<{ id: string }> }).buttons.map((button) => button.id), [
  "trip_type:one_way",
  "trip_type:return",
]);

console.log("conversation workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/conversation.workflow.test.ts
```

Expected: FAIL because conversation workflow does not exist.

- [ ] **Step 3: Implement minimal in-memory-free workflow contract**

Implement `handleConversationEvent` with injected repository defaults. The first implementation may use a test repository in the test file, but production workflow code must depend on repository interfaces, not module-global memory.

Required behavior:

```text
inbound text with destination/date but no origin -> origin_list UI
origin:LOS reply -> stores origin and emits trip_type buttons
trip_type:one_way -> emits passenger count buttons
passengers:1 -> emits search-ready result
```

Use explicit structured IDs only.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/conversation.workflow.test.ts
npm run typecheck
```

Expected: workflow test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workflows/conversation.workflow.ts backend/src/domain/conversation backend/tests/workflow/conversation.workflow.test.ts
git commit -m "feat: add whatsapp conversation workflow"
```

---

## Task 5A: AI Intent Extractor Seam

**Files:**
- Create: `backend/src/agent/intent-extractor.ts`
- Modify: `backend/src/workflows/conversation.workflow.ts`
- Modify: `backend/tests/workflow/conversation.workflow.test.ts`

- [ ] **Step 1: Write failing extractor-seam tests**

Add tests to `backend/tests/workflow/conversation.workflow.test.ts` proving:

```ts
const fakeExtractor = {
  calls: 0,
  async extractTripIntent() {
    this.calls++;
    return {
      origin: "PHC",
      destination: "KAN",
      departureDate: "2026-05-06",
      adults: 3,
    };
  },
};

const result = await handleConversationEvent(
  {
    type: "inbound_text",
    contact: { phoneNumber: "2348044444444" },
    text: "Book me PH to Kano next week for 3 adults",
    providerMessageId: "wamid.extract.1",
    now: new Date("2026-04-29T08:00:00.000Z"),
  },
  {
    conversationRepository: createInMemoryConversationRepository(),
    intentExtractor: fakeExtractor,
  }
);

assert.equal(result.kind, "needs_user_input");
assert.equal(result.field, "trip_type");
assert.equal(fakeExtractor.calls, 1);
```

Also add tests that:

- `expectedField: "passenger_count"` can be filled from text through the extractor.
- `interactive_reply` events do not call the extractor.
- Existing first-time flow tests still pass.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/conversation.workflow.test.ts
```

Expected: FAIL because `intentExtractor` dependency and `agent/intent-extractor.ts` do not exist.

- [ ] **Step 3: Implement extractor seam**

Create `backend/src/agent/intent-extractor.ts`:

```ts
import type { ConversationDraft, ConversationExpectedField } from "../domain/conversation/conversation.service.js";

export type TripIntentExtraction = {
  origin?: string;
  destination?: string;
  departureDate?: string;
  departureWindow?: string;
  returnDate?: string;
  adults?: number;
};

export type IntentExtractionInput = {
  text: string;
  now: Date;
  expectedField?: ConversationExpectedField;
  currentDraft: ConversationDraft;
};

export type IntentExtractor = {
  extractTripIntent(input: IntentExtractionInput): Promise<TripIntentExtraction>;
};
```

Add `createRuleBasedIntentExtractor()` as a deterministic local fallback. It may handle only the current known phrases: Abuja, tomorrow, morning, `next week`, ISO dates, and numeric passenger counts. This fallback exists for local determinism; the production AI implementation can replace it behind the same interface.

Modify `handleConversationEvent` so inbound text calls the injected/default extractor and merges returned safe fields into the draft. Workflow code still owns prompts, expected-field state, stale reply behavior, and search readiness. `interactive_reply` must not call the extractor.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/conversation.workflow.test.ts
npm run test:workflow
npm run test:all
npm run typecheck
npm run typecheck:test
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agent/intent-extractor.ts backend/src/workflows/conversation.workflow.ts backend/tests/workflow/conversation.workflow.test.ts docs/superpowers/plans/2026-04-29-whatsapp-backend-rewrite.md
git commit -m "feat: add conversation intent extractor seam"
```

---

## Task 6: Flight Search Repository And Ranking SQL

**Files:**
- Create: `backend/src/domain/flight/flight.repository.ts`
- Create: `backend/src/domain/flight/flight-search.service.ts`
- Create: `backend/src/workflows/flight-search.workflow.ts`
- Test: `backend/tests/unit/flight-ranking.test.ts`

- [ ] **Step 1: Write failing ranking test**

Create `backend/tests/unit/flight-ranking.test.ts`:

```ts
import assert from "node:assert/strict";

import { rankFlightOptionsForDisplay } from "../../src/domain/flight/flight-search.service.js";

const ranked = rankFlightOptionsForDisplay([
  { id: "a", airline: "Air Peace", departureTime: "06:45", price: 171000, stops: 0, baggageIncluded: true },
  { id: "b", airline: "ValueJet", departureTime: "07:30", price: 142000, stops: 0, baggageIncluded: false },
  { id: "c", airline: "Ibom Air", departureTime: "08:45", price: 158000, stops: 0, baggageIncluded: true },
]);

assert.equal(ranked.cheapest.id, "b");
assert.equal(ranked.earliest.id, "a");
assert.equal(ranked.bestValue.id, "c");
console.log("flight ranking tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/flight-ranking.test.ts
```

Expected: FAIL because flight search service does not exist.

- [ ] **Step 3: Implement ranking and SQL repository**

Implement deterministic ranking in `flight-search.service.ts`. Implement repository functions that use Drizzle raw SQL for stored option lookup:

```ts
import { sql } from "drizzle-orm";

export async function findRankedOptionsForSearch(db: AppDb, searchId: string) {
  return db.execute(sql`
    select *
    from flight_options
    where search_id = ${searchId}
    order by price_amount asc, departure_at asc
  `);
}
```

The service can rank in memory for unit tests, but repository SQL must exist for production stored flight lookups.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/unit/flight-ranking.test.ts
npm run typecheck
```

Expected: ranking test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/flight backend/src/workflows/flight-search.workflow.ts backend/tests/unit/flight-ranking.test.ts
git commit -m "feat: add flight ranking workflow foundation"
```

---

## Task 7: Booking Workflow With Alias Creation

**Files:**
- Create: `backend/src/domain/booking/booking.repository.ts`
- Create: `backend/src/domain/booking/booking.service.ts`
- Create: `backend/src/integrations/resend/booking-alias.service.ts`
- Create: `backend/src/workflows/booking.workflow.ts`
- Test: `backend/tests/workflow/booking.workflow.test.ts`

- [ ] **Step 1: Write failing booking workflow test**

Create `backend/tests/workflow/booking.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import { createBookingFromSelectedOption } from "../../src/workflows/booking.workflow.js";

const result = await createBookingFromSelectedOption({
  userId: "user_123",
  conversationId: "conv_123",
  selectedFlightOptionId: "opt_123",
  inboundDomain: "bookings.wakanow.com",
  now: new Date("2026-04-29T09:00:00.000Z"),
});

assert.equal(result.kind, "ok");
if (result.kind === "ok") {
  assert.equal(result.value.status, "priced");
  assert.match(result.value.bookingEmailAlias, /^book_[a-z0-9]+@bookings\.wakanow\.com$/);
}

console.log("booking workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/booking.workflow.test.ts
```

Expected: FAIL because booking workflow does not exist.

- [ ] **Step 3: Implement booking creation**

Implement:

```text
create booking in priced status
attach selected flight option ID
generate booking alias on inbound domain
write audit event booking.created
return booking summary
```

Alias generation must be deterministic enough for tests by allowing injected ID generation.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/booking.workflow.test.ts
npm run typecheck
```

Expected: booking workflow test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/booking backend/src/integrations/resend/booking-alias.service.ts backend/src/workflows/booking.workflow.ts backend/tests/workflow/booking.workflow.test.ts
git commit -m "feat: create booking drafts with resend aliases"
```

---

## Task 8: Supplier Hold Workflow

**Files:**
- Create: `backend/src/integrations/wakanow/wakanow.types.ts`
- Create: `backend/src/integrations/wakanow/wakanow.booking.ts`
- Create: `backend/src/workflows/supplier-booking.workflow.ts`
- Test: `backend/tests/workflow/supplier-booking.workflow.test.ts`

- [ ] **Step 1: Write failing supplier hold test**

Create `backend/tests/workflow/supplier-booking.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import { handleSupplierHoldResult } from "../../src/workflows/supplier-booking.workflow.js";

const hold = handleSupplierHoldResult({
  bookingId: "book_123",
  result: {
    kind: "hold_created",
    supplier: "wakanow",
    supplierBookingRef: "WK123",
    expiresAt: new Date("2026-04-29T18:00:00.000Z"),
    amountDue: 161000,
    currency: "NGN",
    rawStatus: "Active",
  },
});

assert.equal(hold.status, "awaiting_payment_for_hold");
assert.equal(hold.supplierBookingRef, "WK123");

const instant = handleSupplierHoldResult({
  bookingId: "book_456",
  result: {
    kind: "instant_purchase_required",
    supplier: "wakanow",
    reason: "Travel date is less than one week away",
    amountDue: 161000,
    currency: "NGN",
    rawStatus: "InstantPurchase",
  },
});

assert.equal(instant.status, "payment_pending");
assert.equal(instant.policy, "payment_first");
console.log("supplier booking workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/supplier-booking.workflow.test.ts
```

Expected: FAIL because supplier workflow does not exist.

- [ ] **Step 3: Implement normalized hold result handling**

Implement `SupplierHoldResult` exactly as defined in the spec and map:

```text
hold_created -> awaiting_payment_for_hold, policy hold_first
instant_purchase_required -> payment_pending, policy payment_first
hold_unavailable -> payment_pending, policy payment_first
unclear -> manual_review_required
```

Persist supplier events and sanitized raw status through repository interfaces.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/supplier-booking.workflow.test.ts
npm run typecheck
```

Expected: supplier workflow test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/wakanow backend/src/workflows/supplier-booking.workflow.ts backend/tests/workflow/supplier-booking.workflow.test.ts
git commit -m "feat: add wakanow hold policy workflow"
```

---

## Task 9: Payment Workflow

**Files:**
- Create: `backend/src/domain/payment/payment.repository.ts`
- Create: `backend/src/domain/payment/payment.service.ts`
- Create: `backend/src/integrations/payments/bank-transfer.ts`
- Create: `backend/src/integrations/payments/card.ts`
- Create: `backend/src/workflows/payment.workflow.ts`
- Test: `backend/tests/workflow/payment.workflow.test.ts`

- [ ] **Step 1: Write failing payment workflow test**

Create `backend/tests/workflow/payment.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import { handlePaidClaim, confirmPayment } from "../../src/workflows/payment.workflow.js";

const paidClaim = handlePaidClaim({
  bookingId: "book_123",
  paymentAttemptId: "pay_123",
  claimedAt: new Date("2026-04-29T10:00:00.000Z"),
});

assert.equal(paidClaim.paymentStatus, "proof_uploaded");
assert.equal(paidClaim.bookingStatus, "payment_pending");

const confirmed = confirmPayment({
  bookingId: "book_123",
  paymentAttemptId: "pay_123",
  confirmedBy: "bank_transfer_reconciliation",
  confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
});

assert.equal(confirmed.paymentStatus, "confirmed");
assert.equal(confirmed.bookingStatus, "payment_confirmed");
console.log("payment workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/payment.workflow.test.ts
```

Expected: FAIL because payment workflow does not exist.

- [ ] **Step 3: Implement payment workflow**

Implement:

```text
create payment attempt
handle payment_method:transfer
handle payment:paid_claimed as proof_uploaded, not confirmed
confirm payment only from trusted source
return needs_manual_review for card until provider is configured
write audit event on confirmation
```

Use Drizzle raw SQL in repository for conditional payment confirmation:

```sql
update payment_attempts
set status = 'confirmed', confirmed_at = $1
where id = $2 and status in ('pending', 'proof_uploaded')
returning *
```

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/payment.workflow.test.ts
npm run typecheck
```

Expected: payment workflow test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/payment backend/src/integrations/payments backend/src/workflows/payment.workflow.ts backend/tests/workflow/payment.workflow.test.ts
git commit -m "feat: add deterministic payment workflow"
```

---

## Task 10: Resend Inbound Email Workflow

**Files:**
- Modify: `backend/src/integrations/resend/resend.client.ts`
- Modify: `backend/src/integrations/resend/resend.webhook-verifier.ts`
- Create: `backend/src/domain/inbound-email/inbound-email.repository.ts`
- Create: `backend/src/domain/inbound-email/inbound-email.service.ts`
- Create: `backend/src/workflows/inbound-email.workflow.ts`
- Test: `backend/tests/workflow/inbound-email.workflow.test.ts`

- [ ] **Step 1: Write failing inbound email workflow test**

Create `backend/tests/workflow/inbound-email.workflow.test.ts`:

```ts
import assert from "node:assert/strict";

import { classifyInboundEmail, handleInboundEmail } from "../../src/workflows/inbound-email.workflow.js";

const classified = classifyInboundEmail({
  subject: "Your Wakanow verification code",
  text: "Use 493821 to complete your booking.",
  from: "noreply@wakanow.com",
});

assert.equal(classified.classification, "verification_code");
assert.equal(classified.hasCode, true);

const handled = await handleInboundEmail({
  resendEmailId: "email_123",
  to: "book_abc@bookings.wakanow.com",
  from: "noreply@wakanow.com",
  subject: "Your Wakanow verification code",
  text: "Use 493821 to complete your booking.",
  receivedAt: new Date("2026-04-29T10:04:00.000Z"),
});

assert.equal(handled.kind, "ok");
if (handled.kind === "ok") {
  assert.equal(handled.value.classification, "verification_code");
  assert.equal(handled.value.hasCode, true);
  assert.equal("otp" in handled.value, false);
}

console.log("inbound email workflow tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/workflow/inbound-email.workflow.test.ts
```

Expected: FAIL because inbound email workflow does not exist.

- [ ] **Step 3: Implement inbound email workflow**

Implement:

```text
verify alias exists
persist inbound email by resend_email_id idempotently
classify verification_code, booking_confirmation, payment_or_receipt, supplier_change, other
extract OTP for internal use but never return/log the OTP in workflow public result
emit supplier event for verification_code and booking_confirmation
consume OTP once in supplier workflow later
```

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/workflow/inbound-email.workflow.test.ts
npm run typecheck
```

Expected: inbound email workflow test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/inbound-email backend/src/integrations/resend backend/src/workflows/inbound-email.workflow.ts backend/tests/workflow/inbound-email.workflow.test.ts
git commit -m "feat: add resend inbound email workflow"
```

---

## Task 11: WhatsApp Routes And Fast Webhook Intake

**Files:**
- Create: `backend/src/channels/whatsapp/whatsapp.routes.ts`
- Create: `backend/src/channels/whatsapp/whatsapp.client.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/integration/whatsapp.routes.test.ts`

- [ ] **Step 1: Write failing route test**

Create `backend/tests/integration/whatsapp.routes.test.ts`:

```ts
import assert from "node:assert/strict";

import { buildServer } from "../../src/app.js";

const app = await buildServer({
  whatsappVerifyToken: "verify-token",
});

const verify = await app.inject({
  method: "GET",
  url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
});

assert.equal(verify.statusCode, 200);
assert.equal(verify.body, "abc123");

const inbound = await app.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.1",
                  from: "2348012345678",
                  timestamp: "1777449600",
                  type: "text",
                  text: { body: "I need a flight to Abuja tomorrow morning" },
                },
              ],
            },
          },
        ],
      },
    ],
  },
});

assert.equal(inbound.statusCode, 200);
await app.close();
console.log("whatsapp route tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/integration/whatsapp.routes.test.ts
```

Expected: FAIL because route injection options and WhatsApp routes are not wired to the new contract.

- [ ] **Step 3: Implement routes**

Implement:

```text
GET /webhooks/whatsapp verifies hub token
POST /webhooks/whatsapp normalizes inbound messages
persist inbound message before long work
delegate to conversation workflow
send workflow UI intent through WhatsApp client asynchronously where practical
return 200 quickly
```

The route must not call Wakanow search or supplier booking directly.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/integration/whatsapp.routes.test.ts
npm run typecheck
```

Expected: route test passes and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts backend/src/channels/whatsapp backend/tests/integration/whatsapp.routes.test.ts
git commit -m "feat: add whatsapp webhook routes for workflow backend"
```

---

## Task 12: Remove Telegram And Legacy AgentMail Surfaces

**Files:**
- Modify: `backend/src/index.ts`
- Delete: `backend/src/channels/telegram/index.ts`
- Delete: `backend/src/bot/*` if still present
- Delete: `backend/src/services/agentmail.ts` if still present
- Modify: `backend/package.json`
- Modify: `backend/README.md`
- Test: `backend/tests/unit/no-legacy-surfaces.test.ts`

- [ ] **Step 1: Write failing legacy-surface test**

Create `backend/tests/unit/no-legacy-surfaces.test.ts`:

```ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../src", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const source = files(root)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

assert.equal(source.includes("telegram"), false);
assert.equal(source.includes("grammy"), false);
assert.equal(source.includes("agentmail"), false);
console.log("legacy surface tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npx tsx tests/unit/no-legacy-surfaces.test.ts
```

Expected: FAIL while Telegram or AgentMail references remain.

- [ ] **Step 3: Remove legacy surfaces**

Remove:

```text
Telegram imports/startup from src/index.ts
Telegram channel files
AgentMail files and dependencies
grammy dependency
old docs that describe Telegram/AgentMail as current behavior
```

Keep Resend and WhatsApp routes.

- [ ] **Step 4: Verify green**

Run:

```bash
cd backend
npx tsx tests/unit/no-legacy-surfaces.test.ts
npm run typecheck
npm run build
```

Expected: legacy-surface test passes, typecheck exits 0, build exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A backend/src backend/package.json backend/package-lock.json backend/README.md backend/tests/unit/no-legacy-surfaces.test.ts
git commit -m "refactor: remove telegram and agentmail backend surfaces"
```

---

## Task 13: Full Verification Gate

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/README.md`

- [ ] **Step 1: Add aggregate verification script**

Ensure `backend/package.json` has:

```json
{
  "verify": "npm run typecheck && npm run typecheck:test && npm run test:all && npm run build"
}
```

- [ ] **Step 2: Run full verification**

Run:

```bash
cd backend
npm run verify
```

Expected: all tests, typechecks, and build pass.

- [ ] **Step 3: Run stale legacy path sweep**

Run:

```bash
rg -n 'telegram|grammy|agentmail|src/bot|src/services/agentmail|AGENTMAIL' backend/src backend/tests backend/scripts backend/README.md
```

Expected: no output for active backend code. Historical migration docs may be excluded only if explicitly marked archival.

- [ ] **Step 4: Commit verification docs**

```bash
git add backend/package.json backend/README.md
git commit -m "chore: add backend rewrite verification command"
```

---

## Execution Order

1. Task 1: test harness
2. Task 2: Drizzle schema
3. Task 3: domain contracts
4. Task 4: WhatsApp UI mapping
5. Task 5: conversation workflow
6. Task 6: flight ranking/search workflow
7. Task 7: booking and alias workflow
8. Task 8: Wakanow hold policy workflow
9. Task 9: payment workflow
10. Task 10: Resend inbound workflow
11. Task 11: WhatsApp routes
12. Task 12: remove Telegram/AgentMail
13. Task 13: full verification

## Self-Review

- Spec coverage: covers WhatsApp-only backend, clean schema, Drizzle, conversation UI, flight ranking SQL, booking aliases, hold-first/payment-first supplier policy, payment confirmation gate, Resend inbound, no Telegram, and no AgentMail.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: booking status, payment status, email classification, reply IDs, and supplier hold result names match the specs.
- Scope check: this plan intentionally defers admin dashboard UI, refund automation, multi-supplier search, and final card-provider implementation.
