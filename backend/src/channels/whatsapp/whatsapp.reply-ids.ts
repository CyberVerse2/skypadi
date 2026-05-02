const FLIGHT_OPTION_PREFIX = "flight_option:";
const BOOKING_CONFIRM_PREFIX = "booking_confirm:";

export const passengerReplyIds = {
  useDefault: "passenger:use_default",
  different: "passenger:different",
} as const;

export const bookingReplyIds = {
  pickAnotherFlight: "booking_change:flight",
} as const;

export function flightOptionReplyId(selectedFlightOptionId: string): string {
  return `${FLIGHT_OPTION_PREFIX}${selectedFlightOptionId}`;
}

export function selectedFlightOptionIdFromReplyId(replyId: string | undefined): string | undefined {
  if (!replyId?.startsWith(FLIGHT_OPTION_PREFIX)) return undefined;
  return replyId.slice(FLIGHT_OPTION_PREFIX.length);
}

export function bookingConfirmReplyId(selectedFlightOptionId: string): string {
  return `${BOOKING_CONFIRM_PREFIX}${selectedFlightOptionId}`;
}

export function selectedFlightOptionIdFromBookingConfirmReplyId(replyId: string | undefined): string | undefined {
  if (!replyId?.startsWith(BOOKING_CONFIRM_PREFIX)) return undefined;
  return replyId.slice(BOOKING_CONFIRM_PREFIX.length);
}

export function passengerActionFromReplyId(replyId: string | undefined): "use_default" | "different" | undefined {
  if (replyId === passengerReplyIds.useDefault) return "use_default";
  if (replyId === passengerReplyIds.different) return "different";
  return undefined;
}
