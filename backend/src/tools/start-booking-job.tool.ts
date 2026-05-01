import type { UiIntent } from "../channels/whatsapp/whatsapp.types";
import type { BookingDraft } from "../domain/booking/booking.types";
import type { WorkflowResult } from "../workflows/workflow-result";
import type { StartBookingJobToolInput } from "./chat-tool.types";

export async function executeStartBookingJobTool(input: {
  userId: string;
  conversationId: string;
  phoneNumber: string;
  input: StartBookingJobToolInput;
  passengerDetailsFlowId: string;
  createBookingFromSelectedOption: (input: {
    userId: string;
    conversationId: string;
    selectedFlightOptionId: string;
    inboundDomain: string;
  }) => Promise<WorkflowResult<BookingDraft>>;
  inboundDomain?: string;
}): Promise<UiIntent> {
  const result = await input.createBookingFromSelectedOption({
    userId: input.userId,
    conversationId: input.conversationId,
    selectedFlightOptionId: input.input.selectedFlightOptionId,
    inboundDomain: input.inboundDomain ?? "booking.local",
  });

  if (result.kind !== "ok") {
    return { type: "text", body: "I could not start that booking. Please choose another flight." };
  }

  return {
    type: "passenger_details_flow",
    body: "Great choice. Please enter the passenger details.",
    buttonText: "Enter details",
    flowId: input.passengerDetailsFlowId,
    flowToken: result.value.id,
    data: {
      bookingId: result.value.id,
      selectedFlightOptionId: result.value.selectedFlightOptionId,
    },
  };
}
