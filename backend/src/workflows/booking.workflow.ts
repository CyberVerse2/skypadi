import { createPricedBookingDraft } from "../domain/booking/booking.service";
import type {
  BookingDraft,
  BookingRepository,
  CreateBookingDraftInput,
  QueuedSupplierBooking,
  QueueSupplierBookingInput,
} from "../domain/booking/booking.types";
import { passengerSchema, type Passenger } from "../schemas/flight-booking";
import type { WakanowHoldClient } from "../integrations/wakanow/wakanow.booking";
import { supplierBookingJobKey } from "../jobs/booking-queue";
import { handleSupplierHoldResult, recordSupplierHoldDecision, type SupplierBookingRepository, type SupplierHoldDecision } from "./supplier-booking.workflow";
import { makeOk, type WorkflowResult } from "./workflow-result";

export async function createBookingFromSelectedOption(
  input: Omit<CreateBookingDraftInput, "repository"> & Partial<Pick<CreateBookingDraftInput, "repository">>
): Promise<WorkflowResult<BookingDraft>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "booking repository dependency is required" };
  }

  try {
    return makeOk(await createPricedBookingDraft({ ...input, repository: input.repository }));
  } catch (error) {
    return {
      kind: "permanent_failure",
      reason: error instanceof Error ? error.message : "Could not create booking draft",
    };
  }
}

export async function collectPassengerDetailsAndCreateSupplierHold(input: {
  userId: string;
  conversationId: string;
  passenger?: Passenger;
  repository?: BookingRepository;
  supplierClient?: Pick<WakanowHoldClient, "createHold">;
  supplierRepository?: SupplierBookingRepository;
  now?: Date;
}): Promise<WorkflowResult<SupplierHoldDecision>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "booking repository dependency is required" };
  }
  if (!input.supplierClient) {
    return { kind: "temporary_failure", reason: "supplier client dependency is required" };
  }
  if (!input.supplierRepository) {
    return { kind: "temporary_failure", reason: "supplier repository dependency is required" };
  }

  const booking = await input.repository.findActiveBookingForPassengerCollection({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  if (!booking) {
    return { kind: "permanent_failure", reason: "no active priced booking found for passenger collection" };
  }

  const passenger = input.passenger ? validatePassenger(input.passenger) : invalidPassenger("Passenger details must be submitted through the WhatsApp Flow.");
  if (!passenger.ok) {
    return {
      kind: "needs_user_input",
      field: "passenger_details",
      ui: {
        type: "text",
        body: passenger.message,
      },
    };
  }

  const collectedAt = input.now ?? new Date();
  await input.repository.collectPassengerDetails({
    bookingId: booking.id,
    userId: input.userId,
    conversationId: input.conversationId,
    passenger: passenger.value,
    supplierContactEmail: booking.bookingEmailAlias,
    collectedAt,
  });

  const supplierResult = await input.supplierClient.createHold({
    bookingId: booking.id,
    selectedFlightOptionId: booking.selectedFlightOptionId,
    passengerSnapshot: passenger.value,
    contactEmail: booking.bookingEmailAlias,
  }).catch((error) => ({
    kind: "unclear" as const,
    supplier: "wakanow" as const,
    reason: error instanceof Error ? error.message : "Supplier hold failed",
    rawStatus: "supplier_error",
  }));
  const decision = handleSupplierHoldResult({ bookingId: booking.id, result: supplierResult });
  const recordedDecision = await recordSupplierHoldDecision({
    decision,
    repository: input.supplierRepository,
    observedAt: collectedAt,
  });

  if (recordedDecision.status === "manual_review_required") {
    return { kind: "needs_manual_review", reason: recordedDecision.reason ?? "Supplier hold requires manual review" };
  }

  return makeOk(recordedDecision);
}

export async function collectPassengerDetailsAndQueueSupplierBooking(
  input: QueueSupplierBookingInput
): Promise<WorkflowResult<QueuedSupplierBooking>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "booking repository dependency is required" };
  }
  if (!input.jobRepository) {
    return { kind: "temporary_failure", reason: "supplier booking job repository dependency is required" };
  }
  if (!input.enqueueSupplierBooking) {
    return { kind: "temporary_failure", reason: "supplier booking enqueue dependency is required" };
  }

  const booking = await input.repository.findActiveBookingForPassengerCollection({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  if (!booking) {
    return { kind: "permanent_failure", reason: "no active priced booking found for passenger collection" };
  }

  const passenger = input.passenger ? validatePassenger(input.passenger) : invalidPassenger("Passenger details must be submitted through the WhatsApp Flow.");
  if (!passenger.ok) {
    return {
      kind: "needs_user_input",
      field: "passenger_details",
      ui: {
        type: "text",
        body: passenger.message,
      },
    };
  }

  const collectedAt = input.now ?? new Date();
  const job = await input.jobRepository.createQueued({
    bookingId: booking.id,
    graphileJobKey: supplierBookingJobKey(booking.id),
    now: collectedAt,
  });

  try {
    await input.repository.collectPassengerDetails({
      bookingId: booking.id,
      userId: input.userId,
      conversationId: input.conversationId,
      passenger: passenger.value,
      supplierContactEmail: booking.bookingEmailAlias,
      collectedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier booking queue preparation failed";
    await input.jobRepository.markFailed({
      bookingId: booking.id,
      failedAt: new Date(),
      errorMessage: message,
      retryable: true,
    });

    return { kind: "temporary_failure", reason: "supplier booking queue preparation failed" };
  }

  try {
    await input.enqueueSupplierBooking({ bookingId: booking.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier booking enqueue failed";
    await input.jobRepository.markFailed({
      bookingId: booking.id,
      failedAt: new Date(),
      errorMessage: message,
      retryable: true,
    });

    return { kind: "temporary_failure", reason: "supplier booking enqueue failed" };
  }

  return makeOk({
    bookingId: booking.id,
    status: "supplier_booking_pending",
    job,
  });
}

export async function collectDefaultPassengerAndQueueSupplierBooking(
  input: Omit<QueueSupplierBookingInput, "passenger">
): Promise<WorkflowResult<QueuedSupplierBooking>> {
  if (!input.repository) {
    return { kind: "temporary_failure", reason: "booking repository dependency is required" };
  }
  if (!input.repository.findDefaultPassengerForUser) {
    return { kind: "temporary_failure", reason: "default passenger dependency is required" };
  }
  if (!input.repository.collectSavedPassengerDetails) {
    return { kind: "temporary_failure", reason: "saved passenger collection dependency is required" };
  }
  if (!input.jobRepository) {
    return { kind: "temporary_failure", reason: "supplier booking job repository dependency is required" };
  }
  if (!input.enqueueSupplierBooking) {
    return { kind: "temporary_failure", reason: "supplier booking enqueue dependency is required" };
  }

  const booking = await input.repository.findActiveBookingForPassengerCollection({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  if (!booking) {
    return { kind: "permanent_failure", reason: "no active priced booking found for passenger collection" };
  }

  const savedPassenger = await input.repository.findDefaultPassengerForUser(input.userId);
  if (!savedPassenger) {
    return { kind: "permanent_failure", reason: "no saved passenger found" };
  }

  const passenger = validatePassenger(savedPassenger.passenger);
  if (!passenger.ok) {
    return {
      kind: "needs_user_input",
      field: "passenger_details",
      ui: {
        type: "text",
        body: passenger.message,
      },
    };
  }

  const collectedAt = input.now ?? new Date();
  const job = await input.jobRepository.createQueued({
    bookingId: booking.id,
    graphileJobKey: supplierBookingJobKey(booking.id),
    now: collectedAt,
  });

  try {
    await input.repository.collectSavedPassengerDetails({
      bookingId: booking.id,
      userId: input.userId,
      conversationId: input.conversationId,
      passengerId: savedPassenger.id,
      passenger: passenger.value,
      supplierContactEmail: booking.bookingEmailAlias,
      collectedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved passenger queue preparation failed";
    await input.jobRepository.markFailed({
      bookingId: booking.id,
      failedAt: new Date(),
      errorMessage: message,
      retryable: true,
    });

    return { kind: "temporary_failure", reason: "supplier booking queue preparation failed" };
  }

  try {
    await input.enqueueSupplierBooking({ bookingId: booking.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier booking enqueue failed";
    await input.jobRepository.markFailed({
      bookingId: booking.id,
      failedAt: new Date(),
      errorMessage: message,
      retryable: true,
    });

    return { kind: "temporary_failure", reason: "supplier booking enqueue failed" };
  }

  return makeOk({
    bookingId: booking.id,
    status: "supplier_booking_pending",
    job,
  });
}

type PassengerParseResult = { ok: true; value: Passenger } | { ok: false; message: string };

function validatePassenger(passenger: Passenger): PassengerParseResult {
  const parsed = passengerSchema.safeParse(passenger);
  if (!parsed.success) {
    return invalidPassenger("I could not read those passenger details. Please submit the passenger form again.");
  }

  return { ok: true, value: parsed.data };
}

function invalidPassenger(message: string): PassengerParseResult {
  return { ok: false, message };
}
