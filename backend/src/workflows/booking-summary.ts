export type BookingSummaryDetails = {
  route: string;
  flight: string;
  baggage: string;
  fare: number;
  currency: "NGN";
  skypadiFee: number;
};

export function bookingSummaryPassengerFlowBody(input: {
  summary: BookingSummaryDetails;
  passengerPrompt: string;
}): string {
  const total = input.summary.fare + input.summary.skypadiFee;
  return [
    "Great. Here’s your booking summary:",
    `Route: ${input.summary.route}`,
    `Flight: ${input.summary.flight}`,
    `Baggage: ${input.summary.baggage}`,
    `Fare: ${formatNaira(input.summary.fare)}`,
    `Skypadi fee: ${formatNaira(input.summary.skypadiFee)}`,
    `Total: ${formatNaira(total)}`,
    "Prices can change until the ticket is issued, but I’ll confirm with you before any extra charge.",
    input.passengerPrompt,
  ].join("\n");
}

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}
