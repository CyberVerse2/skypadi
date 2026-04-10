# SkyPadi Backend

Fresh reset of the Wakanow backend scraper.

This version is intentionally smaller than the previous one:

- homepage-first Playwright flow
- simple API endpoint
- CLI with live trace logs
- clear failure messages when Wakanow does not confirm a UI action

## Run

```bash
cd /Users/thecyberverse/Code/skypadi/backend
cp .env.example .env
npm run dev
```

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
