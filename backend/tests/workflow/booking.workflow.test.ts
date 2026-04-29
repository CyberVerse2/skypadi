import assert from "node:assert/strict";

import { collectPassengerDetailsAndCreateSupplierHold, createBookingFromSelectedOption } from "../../src/workflows/booking.workflow.js";
import type {
  ActiveBookingForPassengerCollection,
  BookingRepository,
  CollectedPassengerDetails,
  CreateBookingDraftRecord,
} from "../../src/domain/booking/booking.repository.js";

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
  async findActiveBookingForPassengerCollection(input) {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      userId: input.userId,
      conversationId: input.conversationId,
      selectedFlightOptionId: "opt_123",
      bookingEmailAlias: "book_abc123@bookings.wakanow.com",
      status: "priced",
    };
  },
  async collectPassengerDetails(input) {
    collectedPassengerDetails.push(input);
  },
};
const collectedPassengerDetails: CollectedPassengerDetails[] = [];

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

const supplierCalls: ActiveBookingForPassengerCollection[] = [];
const supplierHold = await collectPassengerDetailsAndCreateSupplierHold({
  userId: "user_123",
  conversationId: "conv_123",
  passenger: {
    title: "Mr",
    firstName: "Celestine",
    lastName: "Ejiofor",
    dateOfBirth: "1990-04-12",
    nationality: "Nigerian",
    gender: "Male",
    phone: "08012345678",
    email: "celestine@email.com",
  },
  repository,
  supplierClient: {
    async createHold(input) {
      supplierCalls.push({
        id: input.bookingId,
        userId: "user_123",
        conversationId: "conv_123",
        selectedFlightOptionId: input.selectedFlightOptionId,
        bookingEmailAlias: input.contactEmail,
        status: "supplier_hold_pending",
      });
      return {
        kind: "hold_created",
        supplier: "wakanow",
        supplierBookingRef: "WK123",
        expiresAt: new Date("2026-04-29T18:00:00.000Z"),
        amountDue: 158000,
        currency: "NGN",
        paymentUrl: "https://www.wakanow.com/pay/WK123",
        rawStatus: "active",
      };
    },
  },
  supplierRepository: {
    async applySupplierDecision(input) {
      assert.equal(input.bookingId, "11111111-1111-4111-8111-111111111111");
      assert.equal(input.status, "awaiting_payment_for_hold");
      assert.equal(input.supplierBookingRef, "WK123");
    },
  },
});

assert.equal(supplierHold.kind, "ok");
if (supplierHold.kind === "ok") {
  assert.equal(supplierHold.value.status, "awaiting_payment_for_hold");
  assert.equal(supplierHold.value.supplierBookingRef, "WK123");
}
assert.equal(collectedPassengerDetails.length, 1);
assert.equal(collectedPassengerDetails[0]?.passenger.email, "celestine@email.com");
assert.equal(collectedPassengerDetails[0]?.supplierContactEmail, "book_abc123@bookings.wakanow.com");
assert.equal(supplierCalls.length, 1);

const invalidPassengerDetails = await collectPassengerDetailsAndCreateSupplierHold({
  userId: "user_123",
  conversationId: "conv_123",
  passengerText: "Celestine Ejiofor, male, 08012345678, celestine@email.com",
  repository,
  supplierClient: {
    async createHold() {
      throw new Error("should not call supplier");
    },
  },
  supplierRepository: {
    async applySupplierDecision() {
      throw new Error("should not persist supplier decision");
    },
  },
});

assert.equal(invalidPassengerDetails.kind, "needs_user_input");

let manualReviewRecorded = false;
const supplierFailure = await collectPassengerDetailsAndCreateSupplierHold({
  userId: "user_123",
  conversationId: "conv_123",
  passengerText: "Celestine Ejiofor, male, 08012345678, celestine@email.com, 1990-04-12",
  repository,
  supplierClient: {
    async createHold() {
      throw new Error("supplier unavailable");
    },
  },
  supplierRepository: {
    async applySupplierDecision(input) {
      manualReviewRecorded = true;
      assert.equal(input.status, "manual_review_required");
      assert.equal(input.failureReason, "supplier unavailable");
    },
  },
});

assert.equal(supplierFailure.kind, "needs_manual_review");
assert.equal(manualReviewRecorded, true);
console.log("booking workflow tests passed");
