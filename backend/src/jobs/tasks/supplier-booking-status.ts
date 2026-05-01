import type { BookingStatus } from "../../domain/booking/booking.types";

const advancedSupplierBookingStatuses = new Set<BookingStatus>([
  "manual_review_required",
  "awaiting_payment_for_hold",
  "payment_pending",
  "supplier_verification_required",
  "issued",
]);

export function shouldSkipSupplierBookingForStatus(status: BookingStatus | undefined): boolean {
  return status !== undefined && advancedSupplierBookingStatuses.has(status);
}
