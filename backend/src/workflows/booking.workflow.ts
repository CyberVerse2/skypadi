import { createPricedBookingDraft, type CreateBookingDraftInput } from "../domain/booking/booking.service.js";
import type { BookingDraft } from "../domain/booking/booking.types.js";
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
