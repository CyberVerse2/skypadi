export type TripType = "one_way" | "return";

export type ConversationExpectedField =
  | "origin"
  | "destination"
  | "departure_date"
  | "departure_window"
  | "trip_type"
  | "passengers"
  | "return_date"
  | "passenger_count"
  | "passenger_details";

export type ConversationDraft = {
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  departureWindow?: string;
  tripType?: TripType;
  adults?: number;
  pendingSelectedFlightOptionId?: string;
  expectedField?: ConversationExpectedField;
};

export type ConversationRecord = {
  id: string;
  userId?: string;
  phoneNumber: string;
  status?: ConversationState;
  draft: ConversationDraft;
  updatedAt: Date;
};

export type ConversationRepository = {
  findByPhoneNumber(phoneNumber: string): Promise<ConversationRecord | undefined>;
  save(conversation: ConversationRecord): Promise<ConversationRecord>;
};

export type WhatsAppMessageRepository = {
  recordInboundMessage(input: {
    phoneNumber: string;
    conversationId: string;
    providerMessageId: string;
    textBody?: string;
    payload: Record<string, unknown>;
    receivedAt: Date;
  }): Promise<{ wasCreated: boolean }>;
  recordOutboundMessage?(input: {
    conversationId: string;
    providerMessageId?: string;
    textBody?: string;
    payload: Record<string, unknown>;
    sentAt: Date;
  }): Promise<void>;
  listRecentMessages?(input: {
    conversationId: string;
    limit: number;
  }): Promise<
    Array<{
      direction: "inbound" | "outbound" | "system";
      textBody?: string;
      receivedAt?: Date;
      sentAt?: Date;
    }>
  >;
};

export type ConversationState =
  | "collecting_trip_details"
  | "presenting_flight_options"
  | "collecting_passenger_details"
  | "awaiting_payment_choice"
  | "awaiting_payment_confirmation"
  | "issuing_supplier_booking"
  | "awaiting_supplier_verification"
  | "ticket_issued"
  | "manual_review_required";

export type ChannelContact = {
  channel: "whatsapp";
  phoneNumber: string;
  providerContactId?: string;
  displayName?: string;
};

export type ConversationEvent =
  | {
      kind: "message_received";
      contact: ChannelContact;
      text?: string;
      providerMessageId?: string;
      receivedAt: Date;
      payload?: Record<string, unknown>;
    }
  | {
      kind: "state_changed";
      conversationId: string;
      from: ConversationState;
      to: ConversationState;
      changedAt: Date;
    };
