
import {
  collectPassengerDetailsAndCreateSupplierHold,
  collectPassengerDetailsAndQueueSupplierBooking,
  collectDefaultPassengerAndQueueSupplierBooking,
  createBookingFromSelectedOption,
} from "../../src/workflows/booking.workflow";
import type {
  ActiveBookingForPassengerCollection,
  BookingRepository,
  BookingPassengerRepository,
  CollectedPassengerDetails,
  CreateBookingDraftRecord,
  PassengerRepository,
} from "../../src/domain/booking/booking.types";
import { describe, expect, test } from "vitest";


describe("workflow booking workflow", () => {
  test("booking workflow", async () => {
    expect.hasAssertions();
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
    };
    const collectedPassengerDetails: CollectedPassengerDetails[] = [];
    const passengerCollectingRepository: BookingRepository & Pick<BookingPassengerRepository, "collectPassengerDetails"> = {
      ...repository,
      async collectPassengerDetails(input) {
        collectedPassengerDetails.push(input);
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
      repository: passengerCollectingRepository,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(result.value.status).toBe("priced");
      expect(result.value.userId).toBe("user_123");
      expect(result.value.conversationId).toBe("conv_123");
      expect(result.value.selectedFlightOptionId).toBe("opt_123");
      expect(result.value.bookingEmailAlias).toBe("book_abc123@bookings.wakanow.com");
    }
    expect(writes.length).toBe(1);
    expect(writes[0]?.status).toBe("priced");
    expect(writes[0]?.aliasLocalPart).toBe("book_abc123");

    const invalidDomain = await createBookingFromSelectedOption({
      userId: "user_123",
      conversationId: "conv_123",
      selectedFlightOptionId: "opt_123",
      inboundDomain: "",
      repository,
    });

    expect(invalidDomain.kind).toBe("permanent_failure");

    const missingRepository = await createBookingFromSelectedOption({
      userId: "user_123",
      conversationId: "conv_123",
      selectedFlightOptionId: "opt_123",
      inboundDomain: "bookings.wakanow.com",
    });

    expect(missingRepository.kind).toBe("temporary_failure");

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
      repository: passengerCollectingRepository,
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

    expect(queuedResult.kind).toBe("ok");
    expect(queuedJobInputs.length).toBe(1);
    expect(queuedJobInputs[0]?.bookingId).toBe("11111111-1111-4111-8111-111111111111");
    expect(queuedJobInputs[0]?.graphileJobKey).toBe("supplier-booking:11111111-1111-4111-8111-111111111111");
    expect(enqueuedBookingIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    if (queuedResult.kind === "ok") {
      expect(queuedResult.value.bookingId).toBe("11111111-1111-4111-8111-111111111111");
      expect(queuedResult.value.status).toBe("supplier_booking_pending");
      expect(queuedResult.value.job.bookingId).toBe("11111111-1111-4111-8111-111111111111");
    }
    expect(collectedPassengerDetails.length).toBe(1);
    expect(collectedPassengerDetails[0]?.passenger.email).toBe("celestine@email.com");
    expect(collectedPassengerDetails[0]?.supplierContactEmail).toBe("book_abc123@bookings.wakanow.com");

    const savedPassengerCollections: unknown[] = [];
    const defaultPassengerEnqueues: string[] = [];
    const passengerRepository: PassengerRepository = {
      async findDefaultPassengerForUser(userId) {
        expect(userId).toBe("user_123");
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
    };
    const bookingPassengerRepository: BookingPassengerRepository = {
      async collectPassengerDetails(input) {
        collectedPassengerDetails.push(input);
      },
      async collectSavedPassengerDetails(input) {
        savedPassengerCollections.push(input);
      },
    };
    const defaultPassengerResult = await collectDefaultPassengerAndQueueSupplierBooking({
      userId: "user_123",
      conversationId: "conv_123",
      repository,
      passengerRepository,
      bookingPassengerRepository,
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

    expect(defaultPassengerResult.kind).toBe("ok");
    expect(defaultPassengerEnqueues).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(savedPassengerCollections.length).toBe(1);
    expect(savedPassengerCollections[0]).toEqual({
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
      repository: passengerCollectingRepository,
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

    expect(enqueueFailure.kind).toBe("temporary_failure");
    if (enqueueFailure.kind === "temporary_failure") {
      expect(enqueueFailure.reason).toBe("supplier booking enqueue failed");
    }
    expect(failedJobMarks.length).toBe(1);
    expect(failedJobMarks[0]?.bookingId).toBe("11111111-1111-4111-8111-111111111111");
    expect(failedJobMarks[0]?.errorMessage).toBe("graphile enqueue unavailable");
    expect(failedJobMarks[0]?.retryable).toBe(true);

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
      repository: passengerCollectingRepository,
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
          expect(input.bookingId).toBe("11111111-1111-4111-8111-111111111111");
          expect(input.status).toBe("awaiting_payment_for_hold");
          expect(input.supplierBookingRef).toBe("WK123");
        },
      },
    });

    expect(supplierHold.kind).toBe("ok");
    if (supplierHold.kind === "ok") {
      expect(supplierHold.value.status).toBe("awaiting_payment_for_hold");
      expect(supplierHold.value.supplierBookingRef).toBe("WK123");
    }
    expect(collectedPassengerDetails.length).toBe(3);
    expect(collectedPassengerDetails[2]?.passenger.email).toBe("celestine@email.com");
    expect(collectedPassengerDetails[2]?.supplierContactEmail).toBe("book_abc123@bookings.wakanow.com");
    expect(supplierCalls.length).toBe(1);

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
      repository: passengerCollectingRepository,
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

    expect(invalidPassengerDetails.kind).toBe("needs_user_input");

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
      repository: passengerCollectingRepository,
      supplierClient: {
        async createHold() {
          throw new Error("supplier unavailable");
        },
      },
      supplierRepository: {
        async applySupplierDecision(input) {
          manualReviewRecorded = true;
          expect(input.status).toBe("manual_review_required");
          expect(input.failureReason).toBe("supplier unavailable");
        },
      },
    });

    expect(supplierFailure.kind).toBe("needs_manual_review");
    expect(manualReviewRecorded).toBe(true);
  });
});
