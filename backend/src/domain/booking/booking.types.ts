import type { Passenger } from "../../schemas/flight-booking";

export const bookingStatuses = [
  "draft",
  "priced",
  "passenger_details_collected",
  "payment_pending",
  "payment_confirmed",
  "supplier_hold_pending",
  "supplier_hold_created",
  "awaiting_payment_for_hold",
  "supplier_booking_pending",
  "supplier_verification_required",
  "issued",
  "hold_expired",
  "failed",
  "cancelled",
  "manual_review_required",
] as const;

export type BookingStatus = (typeof bookingStatuses)[number];

export type BookingDraft = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  status: BookingStatus;
  bookingEmailAlias: string;
  createdAt: Date;
};

export type CreateBookingDraftRecord = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  status: BookingStatus;
  bookingEmailAlias: string;
  aliasLocalPart: string;
  aliasDomain: string;
  createdAt: Date;
};

export type BookingRepository = {
  createDraft(input: CreateBookingDraftRecord): Promise<BookingDraft>;
  findActiveBookingForPassengerCollection(input: {
    userId: string;
    conversationId: string;
  }): Promise<ActiveBookingForPassengerCollection | undefined>;
  collectPassengerDetails(input: CollectedPassengerDetails): Promise<void>;
};

export type ActiveBookingForPassengerCollection = {
  id: string;
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  bookingEmailAlias: string;
  status: BookingStatus;
};

export type CollectedPassengerDetails = {
  bookingId: string;
  userId: string;
  conversationId: string;
  passenger: Passenger;
  supplierContactEmail: string;
  collectedAt: Date;
};

export type CreateBookingDraftInput = {
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  inboundDomain: string;
  now?: Date;
  idGenerator?: () => string;
  aliasTokenGenerator?: () => string;
  repository: BookingRepository;
};

const terminalBookingStatuses = new Set<BookingStatus>([
  "issued",
  "hold_expired",
  "failed",
  "cancelled",
  "manual_review_required",
]);

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return terminalBookingStatuses.has(status);
}
