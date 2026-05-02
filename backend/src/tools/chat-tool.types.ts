import type {
  ConversationDraft,
  ConversationExpectedField,
  ConversationState,
} from "../domain/conversation/conversation.types";
import type { Passenger } from "../schemas/flight-booking";

export type ChatContextMessage = {
  direction: "inbound" | "outbound" | "system";
  textBody?: string;
  receivedAt?: string;
  sentAt?: string;
};

export type ChatContext = {
  conversationId: string;
  userId: string;
  phoneNumber: string;
  conversationStatus?: ConversationState;
  currentDraft?: ConversationDraft;
  expectedField?: ConversationExpectedField;
  recentMessages?: ChatContextMessage[];
  latestBookingStatus?: string;
};

export type SearchFlightsToolInput = {
  origin: string;
  destination: string;
  departureDate: string;
  departureWindow?: string;
  returnDate?: string;
  adults: number;
};

export type StartBookingJobToolInput = {
  selectedFlightOptionId: string;
};

export type CollectTripDetailsToolInput = {
  origin?: string;
  destination?: string;
  departureDate?: string;
  departureWindow?: string;
  returnDate?: string;
  adults?: number;
};

export type SendControlledReplyToolInput = {
  key: "skypadi_intro";
};

export type SendCustomClarificationToolInput = {
  body: string;
  widget: {
    type: "reply_buttons" | "list";
    buttonText?: string;
    options: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  };
};

export type CollectPassengerDetailsToolInput = Passenger;

export type ChatToolRequest =
  | {
      type: "tool";
      tool: "searchFlights";
      input: SearchFlightsToolInput;
    }
  | {
      type: "tool";
      tool: "collectTripDetails";
      input: CollectTripDetailsToolInput;
    }
  | {
      type: "tool";
      tool: "startNewTrip";
      input: CollectTripDetailsToolInput;
    }
  | {
      type: "tool";
      tool: "sendControlledReply";
      input: SendControlledReplyToolInput;
    }
  | {
      type: "tool";
      tool: "sendCustomClarification";
      input: SendCustomClarificationToolInput;
    }
  | {
      type: "tool";
      tool: "startBookingJob";
      input: StartBookingJobToolInput;
    }
  | {
      type: "tool";
      tool: "collectPassengerDetails";
      input: CollectPassengerDetailsToolInput;
    };

export type ChatReply = {
  type: "reply";
  message: string;
};

export type ChatAction = ChatReply | ChatToolRequest;

export type DecideChatActionInput = {
  userText: string;
  now: Date;
  context: ChatContext;
};
