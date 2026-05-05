import type { FlightSearchHandler } from "../channels/whatsapp/whatsapp.handlers";
import type { UiIntent } from "../workflows/ui-intent";
import type { SearchFlightsToolInput } from "./chat-tool.types";

export async function executeSearchFlightsTool(input: {
  userId: string;
  conversationId: string;
  phoneNumber: string;
  input: SearchFlightsToolInput;
  flightSearchHandler: FlightSearchHandler;
  onFailure?: (
    error: unknown,
    context: {
      userId: string;
      conversationId: string;
      phoneNumber: string;
      input: SearchFlightsToolInput;
    }
  ) => void;
}): Promise<UiIntent> {
  try {
    return await input.flightSearchHandler.searchAndPresent({
      userId: input.userId,
      conversationId: input.conversationId,
      phoneNumber: input.phoneNumber,
      search: {
        origin: input.input.origin,
        destination: input.input.destination,
        departureDate: input.input.departureDate,
        departureWindow: input.input.departureWindow ?? "anytime",
        tripType: input.input.returnDate ? "return" : "one_way",
        returnDate: input.input.returnDate,
        adults: input.input.adults,
      },
    });
  } catch (error) {
    input.onFailure?.(error, {
      userId: input.userId,
      conversationId: input.conversationId,
      phoneNumber: input.phoneNumber,
      input: input.input,
    });
    return { type: "text", body: "I could not search flights right now. Please try again shortly." };
  }
}
