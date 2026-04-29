import assert from "node:assert/strict";

import { createBookingFromSelectedOption } from "../../src/workflows/booking.workflow.js";
import type { BookingRepository, CreateBookingDraftRecord } from "../../src/domain/booking/booking.repository.js";

const writes: CreateBookingDraftRecord[] = [];
const repository: BookingRepository = {
  async createDraft(input) {
    writes.push(input);
    return {
      id: input.id,
      userId: input.userId,
      conversationId: input.conversationId,
      selectedFlightOptionId: input.selectedFlightOptionId,
      status: input.status,
      bookingEmailAlias: input.bookingEmailAlias,
      createdAt: input.createdAt,
    };
  },
};

const result = await createBookingFromSelectedOption({
  userId: "user_123",
  conversationId: "conv_123",
  selectedFlightOptionId: "opt_123",
  inboundDomain: "bookings.wakanow.com",
  now: new Date("2026-04-29T09:00:00.000Z"),
  idGenerator: () => "11111111-1111-4111-8111-111111111111",
  aliasTokenGenerator: () => "abc123",
  repository,
});

assert.equal(result.kind, "ok");
if (result.kind === "ok") {
  assert.equal(result.value.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.value.status, "priced");
  assert.equal(result.value.userId, "user_123");
  assert.equal(result.value.conversationId, "conv_123");
  assert.equal(result.value.selectedFlightOptionId, "opt_123");
  assert.equal(result.value.bookingEmailAlias, "book_abc123@bookings.wakanow.com");
}
assert.equal(writes.length, 1);
assert.equal(writes[0]?.status, "priced");
assert.equal(writes[0]?.aliasLocalPart, "book_abc123");

const invalidDomain = await createBookingFromSelectedOption({
  userId: "user_123",
  conversationId: "conv_123",
  selectedFlightOptionId: "opt_123",
  inboundDomain: "",
  repository,
});

assert.equal(invalidDomain.kind, "permanent_failure");

const missingRepository = await createBookingFromSelectedOption({
  userId: "user_123",
  conversationId: "conv_123",
  selectedFlightOptionId: "opt_123",
  inboundDomain: "bookings.wakanow.com",
});

assert.equal(missingRepository.kind, "temporary_failure");
console.log("booking workflow tests passed");
