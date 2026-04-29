import { createPricedBookingDraft, type CreateBookingDraftInput } from "../domain/booking/booking.service.js";
import type { BookingRepository } from "../domain/booking/booking.repository.js";
import type { BookingDraft } from "../domain/booking/booking.types.js";
import { passengerSchema, type Passenger } from "../schemas/flight-booking.js";
import type { WakanowHoldClient } from "../integrations/wakanow/wakanow.booking.js";
import { handleSupplierHoldResult, recordSupplierHoldDecision, type SupplierBookingRepository, type SupplierHoldDecision } from "./supplier-booking.workflow.js";
import { makeOk, type WorkflowResult } from "./workflow-result.js";

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
  supplierClient?: WakanowHoldClient;
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
