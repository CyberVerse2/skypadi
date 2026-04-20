# AgentMail integration plan

## Goal

Use AgentMail to (1) auto-solve booking OTPs, (2) capture Wakanow's booking confirmation server-side, and eventually (3) replace the user-facing email with a SkyPadi-branded forward.

## Current state — verified working ✅

Wired in [`api-book.ts`](backend/src/services/wakanow/api-book.ts) via [`services/agentmail.ts`](backend/src/services/agentmail.ts). Env-gated on `AGENTMAIL_API_KEY` — zero change when unset.

Per-booking flow when the key is set:
1. Create fresh AgentMail inbox, use its address as `passenger.email`.
2. On OTP modal: poll inbox up to 90s for a Wakanow message; extract the first 4–6 digit code from `preview`/`text`; enter it. Falls back to `onVerificationCode` (Telegram prompt) if polling times out.
3. After booking success: poll inbox up to 3min for a confirmation (`/wakanow/i` sender OR `/booking|itinerary|reservation|confirm/i` subject). Attach `{ from, subject, receivedAt, preview }` to the response.
4. Bot appends "Confirmation email received from …" to the user-facing success message.

**End-to-end verified** by [`scripts/verify-agentmail.ts`](backend/scripts/verify-agentmail.ts): create inbox → send mail to self → poll → extract OTP → delete inbox. All steps pass.

## Verified API reference

Confirmed against live API (2026-04-19):

| Operation | Method + Path | Response shape |
|---|---|---|
| Auth | `Authorization: Bearer <key>` (base: `https://api.agentmail.to/v0`) | — |
| Create inbox | `POST /inboxes` body `{display_name}` | `{inbox_id, email, display_name, ...}` — **`inbox_id === email`** |
| List inboxes | `GET /inboxes?limit=N` | `{count, limit, inboxes: [...]}` |
| Delete inbox | `DELETE /inboxes/{inbox_id}` | 202 |
| List messages | `GET /inboxes/{inbox_id}/messages?limit=N&after=...` | `{count, limit, messages: [...]}` — items include `preview` (truncated body, no full `text`) |
| Get single message | `GET /inboxes/{inbox_id}/messages/{message_id}` | Full message with `text`/`html` (needs URL-encoded `message_id` — it contains `<>@`) |
| **Send message** | `POST /inboxes/{inbox_id}/messages/send` body `{to, subject, text, html?, reply_to?}` | `{message_id, thread_id}` — **NOT** `/messages` (docs were wrong) |

**Non-obvious findings:**
- Message list returns `preview` (truncated body ~200 chars), not `text`. For most OTP/confirmation matching this is sufficient; for full-body parsing we need `getMessage()` with URL-encoded ID.
- AgentMail appends `"\n\n--\nSent via AgentMail"` to outbound mail.
- Inbox addresses are randomly generated: `<adjective><noun><digits>@agentmail.to`. `display_name` is the only user-visible string we control.

## 🚨 Architectural finding — per-booking inboxes won't scale

**We hit `LimitExceededError` after 3 inbox creates.** Free tier has a low cap (possibly 3). Even paid tiers will make per-booking inbox creation wasteful.

**Fix before going live:** one persistent inbox per user, stored in Postgres keyed by Telegram `user_id`.

```
CREATE TABLE user_inboxes (
  user_id     BIGINT PRIMARY KEY,
  inbox_id    TEXT NOT NULL UNIQUE,  -- equals email address
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

- Create on first booking; reuse for all subsequent bookings.
- Match confirmations by `sinceIso` (booking start time) to disambiguate between multiple bookings from same user.
- Delete the inbox only if the user deletes their account.

[`api-book.ts`](backend/src/services/wakanow/api-book.ts) currently does `agentmail.createInbox(...)` on every call. This must become `getOrCreateUserInbox(userId)`.

## Phase 2 — SkyPadi-branded forward

**Goal:** user sees a SkyPadi email in their personal inbox, not a Wakanow one; we control the content.

### Prerequisites
- [ ] Own a domain (e.g. `skypadi.app`) with DNS access.
- [ ] SPF + DKIM + DMARC records for outbound from that domain. Without these, Gmail spam-folders our forwards.
- [ ] Decide: use AgentMail's `sendMessage` (simple, works today) vs external provider (Resend / Postmark) using our own domain.

### Architecture options

**A. Polling-based** — after successful booking, if confirmation arrives, we forward via `sendMessage`. Simple but misses confirmations that arrive after the booking function returns.

**B. Webhook-based** — AgentMail webhook fires on inbox receive → Fastify endpoint → parse + forward. Catches all confirmations including schedule changes, refunds, delays. **Recommended.**

Webhook registration endpoint not yet probed — docs are thin. Next action: ask support or probe `POST /webhooks`.

**C. Per-user persistent inbox + tagged forwards** (builds on B) — every Wakanow email to `<user>@agentmail.to` gets parsed and re-sent as `bookings@skypadi.app` with the user's real email as recipient. Unified across all future OTAs.

### Parser
Confirmation emails are HTML. For Wakanow specifically, extract:
- Booking reference / PNR
- Passenger names
- Flight segments (airline, date, times, airports)
- Amount, payment deadline, bank-transfer details

Store in a new `booking_confirmations` Postgres table keyed by our internal `bookingId`. Keep the raw email for fallback/audit.

### Send
- From: `bookings@skypadi.app`, reply-to: an address we monitor (AgentMail-managed).
- Template: branded transactional email. Preserve Wakanow's factual details verbatim — do not rewrite facts, just re-present.
- Footer: "Confirmation originally issued by Wakanow; SkyPadi is a booking assistant."

## Open decisions before Phase 2

1. **Domain** — do we own `skypadi.app` (or similar)? If not, register before any deliverability work.
2. **Email provider** — AgentMail send API vs Resend vs SES. AgentMail works today; Resend is stronger for templated transactional mail and better-documented deliverability.
3. **Inbox cap** — check AgentMail dashboard for our tier's inbox limit; may require upgrade before multi-user beta.
4. **Webhook registration** — probe the webhook endpoint or ask support.
5. **Support inbox routing** — replies to forwards go where? Telegram notification, separate human queue, or auto-replied with "reply to Wakanow at x"?

## Next concrete step (recommended)

Switch to per-user persistent inboxes (see "Architectural finding" above) so we don't hit the limit in multi-user testing. That's a ~30-minute change:
1. Add `user_inboxes` table migration in [`db.ts`](backend/src/db.ts).
2. New helper `getOrCreateUserInbox(userId)` in [`agentmail.ts`](backend/src/services/agentmail.ts).
3. Caller (bot/ai.ts) passes `user_id` into `bookFlightApi`; `bookFlightApi` calls the helper instead of `createInbox`.

After that we're ready to iterate on Phase 2.
