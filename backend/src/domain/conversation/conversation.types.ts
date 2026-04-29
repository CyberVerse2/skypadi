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
