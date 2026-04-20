# SkyPadi Backend

Flight search and booking backend for SkyPadi.

This version is intentionally smaller than the previous one:

- homepage-first Playwright flow
- simple API endpoint
- CLI with live trace logs
- clear failure messages when the provider does not confirm a UI action

## Run

```bash
cd /Users/thecyberverse/Code/skypadi/backend
cp .env.example .env
npm run dev
```

Set `DATABASE_URL` in `.env` to your Postgres instance before starting the server. On boot, SkyPadi provisions these Postgres tables automatically if they do not already exist: `users`, `passenger_profiles`, `booking_attempts`, `payment_attempts`, and `audit_events`.

For remote servers, let Patchright use its bundled browser by default. Only set `WAKANOW_BROWSER_CHANNEL=chrome` if the host has a working system Chrome install and you explicitly want that channel.

## CLI

```bash
cd /Users/thecyberverse/Code/skypadi/backend
node --import tsx scripts/cli.ts \
  --origin LOS \
  --destination DXB \
  --departure 2026-06-10 \
  --return 2026-06-17 \
  --headed \
  --verbose \
  --debug
```

## API

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
