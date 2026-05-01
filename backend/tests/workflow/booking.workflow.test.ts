import assert from "node:assert/strict";

import {
  collectPassengerDetailsAndCreateSupplierHold,
  collectPassengerDetailsAndQueueSupplierBooking,
  collectDefaultPassengerAndQueueSupplierBooking,
  createBookingFromSelectedOption,
} from "../../src/workflows/booking.workflow";
import type {
  ActiveBookingForPassengerCollection,
  BookingRepository,
  CollectedPassengerDetails,
  CreateBookingDraftRecord,
} from "../../src/domain/booking/booking.types";

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
const enqueuedBookingIds: string[] = [];
const queuedJobInputs: Array<{ bookingId: string; graphileJobKey: string; now: Date }> = [];
const queuedResult = await collectPassengerDetailsAndQueueSupplierBooking({
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
  jobRepository: {
    async createQueued(input) {
      queuedJobInputs.push(input);
      return {
        id: "job_123",
        bookingId: input.bookingId,
        graphileJobKey: input.graphileJobKey,
        status: "queued",
        attemptCount: 0,
        queuedAt: input.now,
        updatedAt: input.now,
      };
    },
    async markRunning() {
      throw new Error("not used in this test");
    },
    async markSucceeded() {
      throw new Error("not used in this test");
    },
    async markFailed() {
      throw new Error("not used in this test");
    },
  },
  async enqueueSupplierBooking(payload) {
    enqueuedBookingIds.push(payload.bookingId);
  },
  now: new Date("2026-05-01T12:00:00.000Z"),
});

assert.equal(queuedResult.kind, "ok");
assert.equal(queuedJobInputs.length, 1);
assert.equal(queuedJobInputs[0]?.bookingId, "11111111-1111-4111-8111-111111111111");
assert.equal(queuedJobInputs[0]?.graphileJobKey, "supplier-booking:11111111-1111-4111-8111-111111111111");
assert.deepEqual(enqueuedBookingIds, ["11111111-1111-4111-8111-111111111111"]);
if (queuedResult.kind === "ok") {
  assert.equal(queuedResult.value.bookingId, "11111111-1111-4111-8111-111111111111");
  assert.equal(queuedResult.value.status, "supplier_booking_pending");
  assert.equal(queuedResult.value.job.bookingId, "11111111-1111-4111-8111-111111111111");
}
assert.equal(collectedPassengerDetails.length, 1);
assert.equal(collectedPassengerDetails[0]?.passenger.email, "celestine@email.com");
assert.equal(collectedPassengerDetails[0]?.supplierContactEmail, "book_abc123@bookings.wakanow.com");

const savedPassengerCollections: unknown[] = [];
const defaultPassengerEnqueues: string[] = [];
const defaultPassengerResult = await collectDefaultPassengerAndQueueSupplierBooking({
  userId: "user_123",
  conversationId: "conv_123",
  repository: {
    ...repository,
    async findDefaultPassengerForUser(userId) {
      assert.equal(userId, "user_123");
      return {
        id: "passenger_123",
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
      };
    },
    async collectSavedPassengerDetails(input) {
      savedPassengerCollections.push(input);
    },
  },
  jobRepository: {
    async createQueued(input) {
      return {
        id: "job_saved_passenger",
        bookingId: input.bookingId,
        graphileJobKey: input.graphileJobKey,
        status: "queued",
        attemptCount: 0,
        queuedAt: input.now,
        updatedAt: input.now,
      };
    },
    async markRunning() {
      throw new Error("not used in this test");
    },
    async markSucceeded() {
      throw new Error("not used in this test");
    },
    async markFailed() {
      throw new Error("not used in this test");
    },
  },
  async enqueueSupplierBooking(payload) {
    defaultPassengerEnqueues.push(payload.bookingId);
  },
  now: new Date("2026-05-01T12:03:00.000Z"),
});

assert.equal(defaultPassengerResult.kind, "ok");
assert.deepEqual(defaultPassengerEnqueues, ["11111111-1111-4111-8111-111111111111"]);
assert.equal(savedPassengerCollections.length, 1);
assert.deepEqual(savedPassengerCollections[0], {
  bookingId: "11111111-1111-4111-8111-111111111111",
  userId: "user_123",
  conversationId: "conv_123",
  passengerId: "passenger_123",
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
  supplierContactEmail: "book_abc123@bookings.wakanow.com",
  collectedAt: new Date("2026-05-01T12:03:00.000Z"),
});

const failedJobMarks: Array<{ bookingId: string; errorMessage: string; retryable: boolean }> = [];
const enqueueFailure = await collectPassengerDetailsAndQueueSupplierBooking({
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
  jobRepository: {
    async createQueued(input) {
      return {
        id: "job_failed_enqueue",
        bookingId: input.bookingId,
        graphileJobKey: input.graphileJobKey,
        status: "queued",
        attemptCount: 0,
        queuedAt: input.now,
        updatedAt: input.now,
      };
    },
    async markRunning() {
      throw new Error("not used in this test");
    },
    async markSucceeded() {
      throw new Error("not used in this test");
    },
    async markFailed(input) {
      failedJobMarks.push({
        bookingId: input.bookingId,
        errorMessage: input.errorMessage,
        retryable: input.retryable,
      });
      return {
        id: "job_failed_enqueue",
        bookingId: input.bookingId,
        graphileJobKey: "supplier-booking:11111111-1111-4111-8111-111111111111",
        status: input.retryable ? "retryable_failed" : "terminal_failed",
        attemptCount: 0,
        lastError: input.errorMessage,
        queuedAt: new Date("2026-05-01T12:05:00.000Z"),
        finishedAt: input.failedAt,
        updatedAt: input.failedAt,
      };
    },
  },
  async enqueueSupplierBooking() {
    throw new Error("graphile enqueue unavailable");
  },
  now: new Date("2026-05-01T12:05:00.000Z"),
});

assert.equal(enqueueFailure.kind, "temporary_failure");
if (enqueueFailure.kind === "temporary_failure") {
  assert.equal(enqueueFailure.reason, "supplier booking enqueue failed");
}
assert.equal(failedJobMarks.length, 1);
assert.equal(failedJobMarks[0]?.bookingId, "11111111-1111-4111-8111-111111111111");
assert.equal(failedJobMarks[0]?.errorMessage, "graphile enqueue unavailable");
assert.equal(failedJobMarks[0]?.retryable, true);

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
assert.equal(collectedPassengerDetails.length, 3);
assert.equal(collectedPassengerDetails[2]?.passenger.email, "celestine@email.com");
assert.equal(collectedPassengerDetails[2]?.supplierContactEmail, "book_abc123@bookings.wakanow.com");
assert.equal(supplierCalls.length, 1);

const invalidPassengerDetails = await collectPassengerDetailsAndCreateSupplierHold({
  userId: "user_123",
  conversationId: "conv_123",
  passenger: {
    title: "Mr",
    firstName: "Celestine",
    lastName: "Ejiofor",
    dateOfBirth: "",
    nationality: "Nigerian",
    gender: "Male",
    phone: "08012345678",
    email: "not-an-email",
  },
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
