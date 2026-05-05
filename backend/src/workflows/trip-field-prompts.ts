import type { UiIntent } from "./ui-intent";
import type { ConversationExpectedField } from "../domain/conversation/conversation.types";
import { whatsappOriginRows } from "../domain/flight/airport-catalog";
import { departureWindowReplyId, passengerCountReplyId, tripTypeReplyId } from "./trip-reply-ids";

export function tripFieldPromptIntent(field: ConversationExpectedField): UiIntent {
  if (field === "origin") {
    return {
      type: "origin_list",
      body: "Where are you flying from?",
      rows: whatsappOriginRows,
    };
  }

  if (field === "destination") {
    return { type: "text", body: "Where are you flying to?" };
  }

  if (field === "departure_date") {
    return { type: "text", body: "What date do you want to travel?" };
  }

  if (field === "departure_window") {
    return {
      type: "reply_buttons",
      body: "What time of day works best?",
      buttons: [
        { id: departureWindowReplyId("morning"), title: "Morning" },
        { id: departureWindowReplyId("afternoon"), title: "Afternoon" },
        { id: departureWindowReplyId("evening"), title: "Evening" },
      ],
    };
  }

  if (field === "trip_type") {
    return {
      type: "reply_buttons",
      body: "Is this one-way or return?",
      buttons: [
        { id: tripTypeReplyId("one_way"), title: "One-way" },
        { id: tripTypeReplyId("return"), title: "Return" },
      ],
    };
  }

  if (field === "passengers") {
    return {
      type: "reply_buttons",
      body: "How many adults are travelling?",
      buttons: [
        { id: passengerCountReplyId(1), title: "1 adult" },
        { id: passengerCountReplyId(2), title: "2 adults" },
        { id: passengerCountReplyId("more"), title: "More" },
      ],
    };
  }

  if (field === "return_date") {
    return {
      type: "text",
      body: "Return date collection is next. Please send your return date.",
    };
  }

  if (field === "passenger_details") {
    return passengerDetailsTextFallbackIntent();
  }

  if (field === "passenger_count") {
    return {
      type: "text",
      body: "Please type the number of adults travelling.",
    };
  }

  const exhaustive: never = field;
  return exhaustive;
}

export function passengerDetailsTextFallbackIntent(): UiIntent {
  return {
    type: "text",
    body: "I couldn't open the passenger details form. Please send the passenger's full name, title, gender, date of birth, phone number, and email in one message.",
  };
}
