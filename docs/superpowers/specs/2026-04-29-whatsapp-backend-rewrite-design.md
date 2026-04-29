# WhatsApp Backend Rewrite Design

**Date:** 2026-04-29

**Status:** Approved design direction

## Goal

Rewrite the Skypadi backend internals around a WhatsApp-first, workflow-driven travel booking architecture with a clean Postgres schema, Resend inbound booking aliases, deterministic booking/payment state transitions, and no Telegram or AgentMail legacy code.

## Decisions

- WhatsApp is the only customer messaging channel in the rewritten backend.
- Telegram is removed entirely: no Telegram routes, bot startup, IDs, sessions, or adapters.
- AgentMail is removed entirely.
- Resend inbound email aliases are first-class booking infrastructure.
- The rewrite does not preserve backward compatibility with the current Postgres schema.
- Drizzle owns schema definitions, migrations, and normal typed repository queries.
- Drizzle raw SQL is preferred for flight search/result queries where filtering, sorting, deduping, ranking, or recommendation logic is clearer as SQL.
- Direct raw `pg` SQL is reserved as an escape hatch for cases Drizzle cannot express cleanly.
- Existing external behavior should be preserved where it matters to the product: users can search, compare, book, pay, receive ticket updates, and recover from supplier email/OTP flows through WhatsApp.
- AI does language work only. Deterministic workflows decide and execute business actions.
- Skypadi always asks for origin when the user does not explicitly provide it. Origin should not be silently defaulted.
- User travel preferences should be learned over time from confirmed choices and reused as suggestions, not hard-coded first-run assumptions.
- WhatsApp interactive reply buttons are a first-class conversation primitive for short decisions.

## Core Principle

```text
AI does language.
Workflows do decisions.
Services do irreversible actions.
```

The AI layer may extract intent, classify natural language, summarize options, and write friendly WhatsApp responses. It must not directly issue bookings, confirm payments, consume OTPs, mark tickets issued, trigger refunds, or mutate booking state outside workflow APIs.

## System Shape

Inbound WhatsApp messages and Resend emails enter through adapters. Adapters normalize provider payloads into internal events. Workflows load the current state from Postgres, decide the next transition, call domain services or integrations when allowed, persist changes, write audit events, and emit outbound notification commands.

```text
WhatsApp webhook
  -> normalize inbound message
  -> conversation workflow
  -> AI extraction / response writing
  -> flight search workflow
  -> booking workflow
  -> payment workflow
  -> supplier booking workflow
  -> notification workflow
  -> WhatsApp client

Resend webhook
  -> normalize inbound email
  -> inbound email workflow
  -> supplier event classification
  -> booking workflow / supplier booking workflow
  -> notification workflow
  -> WhatsApp client
```

## Target Folder Structure

```text
backend/src/
  app.ts
  index.ts

  config/
    env.ts
    logger.ts

  channels/
    whatsapp/
      whatsapp.routes.ts
      whatsapp.client.ts
      whatsapp.mapper.ts

  agent/
    agent.client.ts
    intent-extractor.ts
    response-writer.ts
    prompts.ts

  workflows/
    conversation.workflow.ts
    flight-search.workflow.ts
    booking.workflow.ts
    payment.workflow.ts
    supplier-booking.workflow.ts
    inbound-email.workflow.ts
    notification.workflow.ts

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

  db/
    pool.ts
    client.ts
    migrate.ts
    schema.ts
    migrations/
    repositories/

  tests/
    unit/
    workflow/
    integration/
```

## Domain Model

## Persistence Strategy

Use Drizzle as the default persistence layer for schema, migrations, and ordinary repository reads/writes. This gives the rewrite type-safe table definitions, safer refactors, and a clean migration history without adopting a heavy ORM.

Generate SQL migrations from `schema.ts` with Drizzle Kit and apply those migrations intentionally. Do not use schema push for production changes.

Use Drizzle raw SQL through the `sql` template where the query itself is part of the business guarantee or product ranking logic. Booking and payment state transitions may use explicit SQL transactions, `select ... for update`, conditional updates, and idempotency guards so concurrent webhook retries or WhatsApp messages cannot double-confirm payments, double-consume OTPs, or double-submit supplier bookings.

Flight search repositories may use raw SQL by default for stored flight option lookups, filtering, sorting, deduplication, and recommendation ranking. This keeps price, departure time, baggage, airline, stop count, and "best value" comparisons visible and tunable as SQL rather than hiding ranking behavior inside application loops.

Use Drizzle transactions for workflow transitions that must be atomic. Nested workflow operations may use Drizzle savepoints when a sub-step can fail without aborting the whole outer operation.

Use Drizzle indexes, unique constraints, check constraints, enums, and foreign keys in `schema.ts` so idempotency and state-machine guarantees are enforced by Postgres, not only by application code.

Repository functions should hide whether a query uses Drizzle's typed query builder or Drizzle raw SQL. Workflow code should call domain repositories and services rather than importing Drizzle tables or SQL strings directly. Direct `pg` access should be rare and documented at the call site.

### Users And Contacts

`users` represent Skypadi customers. `whatsapp_contacts` represent the WhatsApp identity used to communicate with a user. A user may have one or more WhatsApp contacts over time, but a WhatsApp contact belongs to one user.

### Conversations

`conversations` track the active booking conversation for a WhatsApp contact. `conversation_messages` store inbound and outbound messages with provider IDs, normalized text, timestamps, and metadata.

`user_preferences` stores learned customer preferences such as preferred departure windows, airline tendencies, baggage sensitivity, payment method, and "cheapest vs low-stress" behavior. Preferences are updated from confirmed choices over time. They may be used to recommend defaults, but the first-time flow must not invent important travel details such as origin.

Conversation state:

```text
collecting_trip_details
presenting_flight_options
collecting_passenger_details
awaiting_payment_choice
awaiting_payment_confirmation
issuing_supplier_booking
awaiting_supplier_verification
ticket_issued
manual_review_required
```

### Flights

`flight_searches` store the normalized user request. `flight_options` store normalized supplier results and recommendation metadata. Flight options are snapshots; later supplier price changes do not rewrite historical options.

### Bookings

`bookings` represent the customer-facing booking lifecycle.

Booking status:

```text
draft
priced
passenger_details_collected
payment_pending
payment_confirmed
supplier_booking_pending
supplier_verification_required
issued
failed
cancelled
manual_review_required
```

`booking_passengers` links passengers to bookings and stores passenger snapshots used for supplier booking.

### Payments

`payment_attempts` store payment method, amount, currency, status, provider reference, and review metadata. Payment confirmation cannot be performed by the AI layer. It must go through the payment workflow.

Payment status:

```text
pending
proof_uploaded
confirmed
failed
expired
refunded
manual_review_required
```

### Inbound Emails

`booking_email_aliases` store generated per-booking aliases on the configured Resend inbound domain. `inbound_emails` store received email metadata, body excerpts, classification, and extracted machine-actionable fields.

Email classification:

```text
verification_code
booking_confirmation
payment_or_receipt
supplier_change
other
```

OTP values are sensitive. They may be stored only as long as required for supplier booking and must be consumed once. Logs and audit events must record `hasCode` rather than the code value.

### Supplier Events

`supplier_events` record externally observed events from Wakanow or supplier emails: OTP required, OTP received, booking confirmed, ticket issued, supplier failure, schedule change, or manual review required.

### Audit Events

`audit_events` record state transitions and irreversible actions. Every booking status change, payment confirmation, OTP consumption, supplier booking attempt, and ticket issuance must produce an audit event.

## Workflow Responsibilities

### Conversation Workflow

Receives normalized WhatsApp messages, loads conversation state, asks the AI layer to extract intent or write a response when needed, and delegates business decisions to specialized workflows.

It decides the next prompt based on missing required fields:

- origin
- destination
- departure date
- return date or one-way flag
- passenger count
- optimization preference
- passenger details
- payment method

Origin is always an explicit required field. If a user says "I need a flight to Abuja tomorrow morning" without origin, the next prompt asks where they are flying from. The prompt may use WhatsApp interactive reply buttons for likely origins, but it must not silently assume Lagos.

Optimization preference can be inferred from learned user preferences after enough history exists, but the workflow should still make the recommendation easy to override. For first-time users, Skypadi should show cheapest, best value, and earliest options without requiring a separate preference question.

Use WhatsApp interactive reply buttons for short, bounded choices:

- suggested origin choices when origin is missing
- one-way vs return
- choose between up to three highlighted flight options
- transfer vs card
- "I've paid" vs change payment method
- continue vs change details

Use WhatsApp list messages or Flows when the choice has more than three options or requires structured form data.

### Flight Search Workflow

Validates that the trip request is search-ready, calls the Wakanow search integration, normalizes results, persists option snapshots, ranks options as cheapest, earliest, and best value, and returns a recommendation. Stored flight option querying and ranking should use raw SQL through Drizzle where it makes the filtering and scoring logic easier to inspect and tune.

### Booking Workflow

Owns customer-facing booking status transitions. It creates draft bookings, attaches selected flight options, records passenger snapshots, creates booking email aliases, and moves bookings through payment and supplier states.

### Payment Workflow

Creates payment attempts, records proof or provider callbacks, confirms payment only through deterministic rules or manual operator action, and prevents supplier booking before payment confirmation.

### Supplier Booking Workflow

Calls Wakanow booking integration only when the booking is payment-confirmed. It handles supplier verification requirements, waits for OTP events from inbound email workflow, consumes OTPs once, and marks booking as issued only after supplier confirmation.

### Inbound Email Workflow

Receives normalized Resend emails, matches aliases to bookings, persists email records, classifies email content, extracts OTP or confirmation metadata, emits supplier events, and never logs sensitive OTP values.

### Notification Workflow

Builds outbound WhatsApp messages from workflow outcomes and sends them through the WhatsApp client. It should support reminders and supplier-change alerts later without changing booking workflow internals.

## Integration Boundaries

### WhatsApp

The WhatsApp adapter verifies Meta webhooks, maps inbound messages to internal events, sends outbound text/messages, sends interactive reply buttons/lists/Flows when requested by workflows, and stores provider message IDs. It does not own conversation state or booking logic.

### Resend

The Resend adapter verifies webhook signatures, fetches full inbound email payloads when needed, and passes normalized email data to the inbound email workflow. It does not decide booking state transitions.

### Wakanow

The Wakanow integration owns supplier API/browser automation details. It exposes typed search and booking operations to workflows and does not talk directly to WhatsApp or Resend.

### Payments

Payment integrations expose typed attempt creation, proof handling, status checks, and callbacks. The payment workflow decides when a booking may advance.

## Error Handling

Every workflow returns a typed result:

```text
ok
needs_user_input
needs_manual_review
temporary_failure
permanent_failure
```

Temporary provider failures should be retryable without duplicating irreversible actions. Permanent failures should move the booking to a failure or manual-review status with an audit event and customer-safe WhatsApp message.

## Observability

Use structured logs with correlation IDs:

- `conversationId`
- `bookingId`
- `userId`
- `whatsappMessageId`
- `resendEmailId`
- `supplierBookingRef`

Never log OTP values, payment proof secrets, card details, or full identity documents.

## Testing Strategy

Build from the workflow layer outward with TDD.

Required test groups:

- Unit tests for intent extraction mappers and email classification.
- Workflow tests for conversation state transitions.
- Workflow tests for booking status transitions.
- Workflow tests proving payment confirmation gates supplier booking.
- Workflow tests proving OTPs are consumed once.
- Integration-style route tests for WhatsApp and Resend webhooks using fake workflow dependencies.
- Contract tests for Wakanow normalization and booking result handling.

Representative red-green tests:

```text
RED: first-time WhatsApp user asks for Abuja tomorrow morning.
Expected: conversation asks for origin and may offer likely origin buttons.

RED: user selects or types origin and one-way trip.
Expected: conversation stores trip details and asks passenger count.

RED: returning user has learned low-stress preference.
Expected: search result recommendation uses learned preference as a suggestion while still showing cheapest, best value, and earliest options.

RED: first-time user has no learned preference.
Expected: workflow does not ask a separate optimization question before search; it shows cheapest, best value, and earliest options.

RED: booking is created from selected option.
Expected: booking alias is generated and persisted.

RED: supplier booking is requested before payment confirmation.
Expected: workflow refuses transition.

RED: Resend receives OTP email for booking alias.
Expected: inbound email is persisted, classified, and emits OTP-received supplier event without logging code.

RED: same OTP is consumed twice.
Expected: second consumption fails and audit event records duplicate attempt.
```

## Migration Strategy

This rewrite does not support backward-compatible reads from the current schema. The new schema should be created through explicit migrations. For local development, destructive resets are acceptable only when intentionally invoked by the operator. Production rollout requires a deliberate cutover plan outside this spec.

## Out Of Scope

- Telegram support.
- AgentMail support.
- Backward compatibility with the current Postgres schema.
- Admin dashboard UI.
- Refund automation.
- Multi-supplier search beyond the current Wakanow integration.
- Voice, web chat, or non-WhatsApp customer channels.

## Open Questions

- Which payment confirmation paths are required for the first production cut: bank transfer only, card only, or both?
- Should manual review actions be CLI-only initially, or should we add a minimal operator route/API?

## Self-Review

- Placeholder scan: no TBD/TODO placeholders.
- Scope check: this is a backend rewrite spec, not an implementation plan. It intentionally excludes admin UI, refunds, and multi-supplier expansion.
- Consistency check: WhatsApp is the only channel throughout; AI does not execute irreversible actions; clean schema has no backward-compatible requirement; persistence uses Drizzle by default with raw SQL for exact transactional guarantees and flight search ranking.
