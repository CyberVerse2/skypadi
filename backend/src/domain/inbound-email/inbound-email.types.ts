export type InboundEmailClassification =
  | "verification_code"
  | "booking_confirmation"
  | "payment_or_receipt"
  | "supplier_change"
  | "other";

export type InboundEmailPublicClassification = {
  classification: InboundEmailClassification;
  hasCode: boolean;
};

export type BookingEmailAliasRecord = {
  id: string;
  bookingId: string;
  emailAddress: string;
};

export type InboundEmailRecord = {
  id: string;
  wasCreated: boolean;
};
