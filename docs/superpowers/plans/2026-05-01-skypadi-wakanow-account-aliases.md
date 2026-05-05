# Skypadi Wakanow Account Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Book Wakanow holds through a Skypadi-owned Wakanow account while using per-booking `@bookings.skypadi.com` aliases as supplier contact emails.

**Architecture:** Add a Wakanow account auth helper that logs into Wakanow with env credentials and returns a cached bearer token. The direct API booking client uses the authenticated fetch by default, while tests can still inject a fake fetch. Existing booking aliases remain the supplier contact email.

**Tech Stack:** TypeScript, Node fetch/undici, Fastify backend, Vitest, Resend inbound aliases.

---

### Task 1: Supplier Credential Configuration

**Files:**
- Modify: `backend/src/config.ts`
- Modify: `backend/.env.example`

- [ ] Add optional `WAKANOW_ACCOUNT_EMAIL` and `WAKANOW_ACCOUNT_PASSWORD` to config.
- [ ] Document that they should point to a Skypadi-owned Wakanow account.

### Task 2: Wakanow Account Auth Client

**Files:**
- Create: `backend/src/integrations/wakanow/account-auth.ts`
- Test: `backend/tests/unit/wakanow-account-auth.test.ts`

- [ ] Write a test that the auth client posts password grant credentials to Wakanow token endpoint and returns the access token.
- [ ] Write a test that auth is disabled when credentials are absent.
- [ ] Implement cached account auth and authenticated fetch wrapper.

### Task 3: Authenticated Direct Booking

**Files:**
- Modify: `backend/src/integrations/wakanow/api-booking.ts`
- Modify: `backend/tests/unit/wakanow-api-booking.test.ts`

- [ ] Use authenticated Wakanow account fetch by default.
- [ ] Keep injected `fetchImpl` test path unchanged.
- [ ] Add a test proving default auth headers are attached while `PassengerDetails[0].Email` remains the per-booking alias.

### Task 4: Verify

**Files:**
- No new files.

- [ ] Run `npm run verify` from `backend/`.
- [ ] Report any live Wakanow account setup still needed in production secrets.
