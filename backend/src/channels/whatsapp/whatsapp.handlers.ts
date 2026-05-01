import type { Passenger } from "../../schemas/flight-booking";
import type { UiIntent } from "./whatsapp.types";

export type FlightSearchHandler = {
  searchAndPresent(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    search: {
      origin: string;
      destination: string;
      departureDate: string;
      departureWindow: string;
      tripType: "one_way" | "return";
      returnDate?: string;
      adults: number;
    };
  }): Promise<UiIntent>;
};

export type BookingSelectionHandler = {
  createFromFlightSelection(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    selectedFlightOptionId: string;
  }): Promise<UiIntent>;
  collectPassengerDetails(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    text: string;
    passenger?: Passenger;
  }): Promise<UiIntent | undefined>;
  continueWithDefaultPassenger?(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
  }): Promise<UiIntent | undefined>;
  requestPassengerDetails?(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
  }): Promise<UiIntent | undefined>;
};
