import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { bookFlightApi } from "../src/services/wakanow/api-book.js";

async function main() {
  console.log("Searching...");
  const search = await searchFlightsApi({ origin: "Abuja", destination: "Lagos", departureDate: "2026-04-16", maxResults: 3 });
  const flight = search.results[0];
  console.log(`Flight: ${flight.airline} ${flight.departureTime} ${flight.priceText}`);

  console.log("\nBooking...");
  const booking = await bookFlightApi({
    searchKey: flight.searchKey!,
    flightId: flight.flightId!,
    deeplink: flight.deeplink,
    passenger: { title: "Mr", firstName: "John", lastName: "Doe", dateOfBirth: "1990-06-15", nationality: "Nigerian", gender: "Male", phone: "08012345678", email: "test@example.com" }
  });

  console.log("\n=== RESULT ===");
  console.log("BookingId:", booking.bookingId);
  console.log("Price:", booking.flightSummary.price, booking.flightSummary.currency);
  console.log("Payment URL:", booking.paymentUrl);
  console.log("Bank Transfers:", JSON.stringify(booking.bankTransfers, null, 2));
}

main().catch(e => console.error("ERROR:", e.message));
