# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkyPadi is a flight booking assistant that searches and books flights through an external provider integration. It exposes a REST API (Fastify) and a Telegram bot with AI-powered conversation (Claude via Vercel AI SDK). All code lives under `backend/`.

## Commands

All commands run from `backend/`:

```bash
npm run dev          # Dev server with watch mode (tsx watch)
npm run build        # TypeScript compile to dist/
npm start            # Run compiled output
npm run typecheck    # Type-check without emit
npm run smoke        # Smoke test for search
npm run cli -- --origin LOS --destination DXB --departure 2026-06-10 --return 2026-06-17 --headed --verbose --debug
```

There is no test suite or linter configured.

## Environment

Copy `backend/.env.example` to `backend/.env`. The Telegram bot requires `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY`. Default locale settings target Nigeria (en-NG, NGN, Africa/Lagos). Optional `PROXY_URL` for HTTP proxy on API requests.

## Architecture

### Dual Search Strategy
- **Primary** (`services/wakanow/api-search.ts`): Direct HTTP calls to the current flight provider API. POST to create search → poll for results (max 6 polls, 1.5s interval). Fast (~15s).
- **Fallback** (`services/wakanow/search.ts`): Playwright browser automation. Navigates the provider site, fills forms, scrapes results. Used when API fails.

### Booking Flow
- `services/wakanow/api-book.ts`: Hybrid API + Playwright. Calls booking API, then uses browser for payment form/verification code entry. Captures screenshots on failure.
- `services/wakanow/book.ts`: Full browser-based booking fallback.

### Telegram Bot (`bot/`)
- `bot/index.ts`: Grammy bot handler, session management, callback routing for flight selection/confirmation.
- `bot/ai.ts`: Claude AI integration. Exposes tools: `saveProfile`, `searchFlights`, `searchFlightsMultiDay`, `bookFlight`. System prompt builds context from session state and saved profile.
- `bot/session.ts`: Per-user session (history, search results, selected flight, profile, onboarding state).

### Data Layer
- `db.ts`: PostgreSQL (`pg`). Normalized persistence for `users`, `passenger_profiles`, `booking_attempts`, `payment_attempts`, and `audit_events`.
- `schemas/`: Zod schemas for flight search requests/responses and passenger data. Dates must be YYYY-MM-DD, airport codes are 3-letter IATA.

### Server
- `server.ts`: Fastify with `/health`, `POST /api/flights/search`, `POST /api/flights/book`.
- `index.ts`: Entrypoint. Starts server, initializes bot if tokens are set.

## Key Patterns

- **ESM throughout**: All imports use `.js` extensions (TypeScript with NodeNext resolution).
- **Zod validation**: Request/response schemas validated at API boundary. Custom error classes carry structured details.
- **Stealth browser**: Playwright launches with webdriver detection bypass, Nigerian geolocation spoofing, and cookie injection.
- **Verification code flow**: During booking, bot pauses and asks the Telegram user for the provider verification code, then enters it in the browser.
- **Multi-day search**: Parallelized with concurrency=2 to avoid rate limiting.
- **Airport aliases**: Hardcoded map (~15 airports, Nigeria-focused) for code↔city resolution.
- **Scripts directory**: `backend/scripts/` contains CLI tools, smoke tests, and debug/intercept scripts — not production code.
