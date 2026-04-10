import type { FlightBookingResponse } from "../schemas/flight-booking.js";

export function formatBookingResult(result: FlightBookingResponse): string {
  const lines = [
    `Booking step: *${result.currentStep}*`,
    `Booked at: ${result.bookedAt}`
  ];

  if (result.currentStep === "trip-customization" || result.currentStep === "payment") {
    lines.unshift("Booking submitted successfully!");
  } else if (result.currentStep === "error") {
    lines.unshift("Booking encountered an error.");
  } else if (result.currentStep === "customer-info") {
    lines.unshift("Booking may not have advanced — still on customer info page.");
  }

  // Extract price from page content if available
  const priceMatch = result.pageContent.match(/Trip Total\s*([\w₦$€£,.\d\s]+)/i);
  if (priceMatch) {
    lines.push(`*Total:* ${priceMatch[1].trim()}`);
  }

  return lines.join("\n");
}
