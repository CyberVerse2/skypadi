import type { FlightSearchHandler } from "../channels/whatsapp/whatsapp.routes";
import type { UiIntent } from "../channels/whatsapp/whatsapp.types";
import type { SearchFlightsToolInput } from "./chat-tool.types";

export async function executeSearchFlightsTool(input: {
  userId: string;
  conversationId: string;
  phoneNumber: string;
  input: SearchFlightsToolInput;
  flightSearchHandler: FlightSearchHandler;
}): Promise<UiIntent> {
  return input.flightSearchHandler.searchAndPresent({
    userId: input.userId,
    conversationId: input.conversationId,
    phoneNumber: input.phoneNumber,
    search: {
      origin: input.input.origin,
      destination: input.input.destination,
      departureDate: input.input.departureDate,
      departureWindow: "anytime",
      tripType: input.input.returnDate ? "return" : "one_way",
      returnDate: input.input.returnDate,
      adults: input.input.adults,
    },
  });
}
