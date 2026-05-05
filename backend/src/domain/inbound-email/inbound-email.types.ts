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

export type InboundEmailContent = {
  subject: string;
  text?: string;
  html?: string;
  from: string;
};

export type InternalInboundEmailClassification = InboundEmailPublicClassification & {
  otp?: string;
};

export type SaveInboundEmailInput = {
  bookingId: string;
  bookingEmailAliasId: string;
  resendEmailId: string;
  messageId?: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: Date;
  classification: InboundEmailClassification;
  extractedOtp?: string;
  raw?: Record<string, unknown>;
};

export type InboundEmailRepository = {
  findActiveAliasByEmail(emailAddress: string): Promise<BookingEmailAliasRecord | undefined>;
  findFirstActiveAliasByEmails?(emailAddresses: string[]): Promise<BookingEmailAliasRecord | undefined>;
  saveInboundEmail(input: SaveInboundEmailInput): Promise<InboundEmailRecord>;
  claimNextUnconsumedOtp(input: {
    bookingId: string;
    claimedAt: Date;
    claimExpiresBefore: Date;
  }): Promise<{ inboundEmailId: string; otp: string } | undefined>;
  consumeOtp(input: { inboundEmailId: string; consumedAt: Date }): Promise<void>;
  recordSupplierEvent(input: {
    bookingId: string;
    inboundEmailId: string;
    supplier: "wakanow";
    eventType: string;
    payload: Record<string, unknown>;
    observedAt: Date;
  }): Promise<void>;
};
