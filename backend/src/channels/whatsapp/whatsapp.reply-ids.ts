const BOOKING_CONFIRM_PREFIX = "booking_confirm:";

export {
  selectedFlightOptionIdFromReplyId,
} from "../../workflows/flight-option-reply-ids";

export const passengerReplyIds = {
  useDefault: "passenger:use_default",
  different: "passenger:different",
} as const;

export const bookingReplyIds = {
  pickAnotherFlight: "booking_change:flight",
} as const;

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
