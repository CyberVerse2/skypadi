# SkyPadi Backend

Flight search and booking backend for SkyPadi.

This backend is WhatsApp-first, tool-driven, and job-backed:

- WhatsApp Cloud API webhook intake
- Drizzle/Postgres persistence
- Resend inbound booking aliases
- Wakanow search and supplier booking jobs
- deterministic payment and supplier state transitions

## Run

```bash
cd /Users/thecyberverse/Code/skypadi/backend
cp .env.example .env
npm run dev
```

Set `DATABASE_URL` in `.env` to your Postgres instance before starting the server. Run Drizzle migrations before serving production traffic.

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

To receive WhatsApp Cloud API messages, set:

```bash
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
OPENAI_API_KEY=...
```

Then configure Meta's webhook callback URL to `https://your-domain/webhooks/whatsapp`. The verification endpoint uses `WHATSAPP_VERIFY_TOKEN`; outbound replies use the access token and phone number ID. `WHATSAPP_APP_SECRET` enables request signature verification.

To receive Wakanow booking emails through Resend Inbound, set:

```bash
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=...
RESEND_INBOUND_DOMAIN=bookings.example.com
```

Then configure a Resend webhook for `email.received` events at `https://your-domain/webhooks/resend`. Skypadi generates per-booking aliases on that inbound domain, persists aliases and received emails in Postgres, and routes OTP/confirmation emails from the webhook.

Wakanow booking runs through the direct API client. Browser automation is no longer part of the production booking path.

## Structure

```text
src/
  app.ts                    # Fastify app construction
  index.ts                  # process startup
  agent/                    # channel-neutral AI conversation logic
  channels/
    whatsapp/               # WhatsApp Cloud API adapter
  db/                       # Drizzle schema, migrations, and client
  domain/                   # workflow-owned domain contracts and repositories
  integrations/
    resend/                 # Resend inbound email + webhook route
    wakanow/                # Wakanow search and hold adapters
    payments/               # bank transfer and card provider seams
  schemas/                  # shared request/booking schema types
  workflows/                # conversation, booking, payment, supplier, email flows
tests/                      # TypeScript tests
scripts/                    # operator/debug scripts
```

Run `npm run verify` before shipping backend changes.
Run `npm run test:all` for the focused backend tests.
Run `npm run typecheck:test` when changing tests or test-only imports.

## API

`GET /webhooks/whatsapp`

WhatsApp webhook verification endpoint.

`POST /webhooks/whatsapp`

Receives inbound WhatsApp messages, runs the Skypadi AI travel-agent flow, and sends replies back through WhatsApp Cloud API.

`POST /webhooks/resend`

Receives Resend `email.received` events for Wakanow booking aliases, fetches the full received email, and classifies it as a verification code, booking confirmation, or other mail.

`POST /api/flights/search`

Example body:

```json
{
  "origin": "LOS",
  "destination": "DXB",
  "departureDate": "2026-06-10",
  "returnDate": "2026-06-17"
}
```
