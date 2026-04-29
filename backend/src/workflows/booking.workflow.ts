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
  passengerText?: string;
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

  const passenger = input.passenger ? validatePassenger(input.passenger) : parsePassengerDetails(input.passengerText ?? "");
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

function parsePassengerDetails(text: string): PassengerParseResult {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 5) {
    return {
      ok: false,
      message: "Please send passenger details as: full name, gender, phone number, email, date of birth YYYY-MM-DD.",
    };
  }

  const [fullName, rawGender, phone, email, dateOfBirth] = parts;
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) {
    return {
      ok: false,
      message: "Please include the passenger's first and last name as it appears on their ID.",
    };
  }

  const gender = normalizeGender(rawGender);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts[nameParts.length - 1] ?? "";
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : undefined;
  const parsed = passengerSchema.safeParse({
    title: gender === "Female" ? "Ms" : "Mr",
    firstName,
    middleName,
    lastName,
    dateOfBirth,
    nationality: "Nigerian",
    gender,
    phone,
    email,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "I could not read those passenger details. Please send: full name, gender, phone number, email, date of birth YYYY-MM-DD.",
    };
  }

  return { ok: true, value: parsed.data };
}

function validatePassenger(passenger: Passenger): PassengerParseResult {
  const parsed = passengerSchema.safeParse(passenger);
  if (!parsed.success) {
    return {
      ok: false,
      message: "I could not read those passenger details. Please submit the passenger form again.",
    };
  }

  return { ok: true, value: parsed.data };
}

function normalizeGender(value: string | undefined): "Male" | "Female" | undefined {
  if (/^m(ale)?$/i.test(value ?? "")) return "Male";
  if (/^f(emale)?$/i.test(value ?? "")) return "Female";
  return undefined;
}
