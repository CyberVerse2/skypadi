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
