export type ChatContext = {
  conversationId: string;
  userId: string;
  phoneNumber: string;
  latestBookingStatus?: string;
};

export type SearchFlightsToolInput = {
  origin: string;
  destination: string;
  departureDate: string;
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
