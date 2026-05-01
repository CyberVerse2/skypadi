import type {
  ConversationDraft,
  ConversationExpectedField,
  ConversationState,
} from "../domain/conversation/conversation.types";

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

export type ChatToolRequest =
  | {
      type: "tool";
      tool: "searchFlights";
      input: SearchFlightsToolInput;
    }
  | {
      type: "tool";
      tool: "startBookingJob";
      input: StartBookingJobToolInput;
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
