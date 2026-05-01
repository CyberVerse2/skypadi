const FLIGHT_OPTION_PREFIX = "flight_option:";

export const passengerReplyIds = {
  useDefault: "passenger:use_default",
  different: "passenger:different",
} as const;

export function flightOptionReplyId(selectedFlightOptionId: string): string {
  return `${FLIGHT_OPTION_PREFIX}${selectedFlightOptionId}`;
}

export function selectedFlightOptionIdFromReplyId(replyId: string | undefined): string | undefined {
  if (!replyId?.startsWith(FLIGHT_OPTION_PREFIX)) return undefined;
  return replyId.slice(FLIGHT_OPTION_PREFIX.length);
}

export function passengerActionFromReplyId(replyId: string | undefined): "use_default" | "different" | undefined {
  if (replyId === passengerReplyIds.useDefault) return "use_default";
  if (replyId === passengerReplyIds.different) return "different";
  return undefined;
}
