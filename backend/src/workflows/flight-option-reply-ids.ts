const FLIGHT_OPTION_PREFIX = "flight_option:";

export function flightOptionReplyId(selectedFlightOptionId: string): string {
  return `${FLIGHT_OPTION_PREFIX}${selectedFlightOptionId}`;
}

export function selectedFlightOptionIdFromReplyId(replyId: string | undefined): string | undefined {
  if (!replyId?.startsWith(FLIGHT_OPTION_PREFIX)) return undefined;
  return replyId.slice(FLIGHT_OPTION_PREFIX.length);
}
