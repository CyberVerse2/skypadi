import "dotenv/config";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { bookFlightApi, generateTestPassenger } from "../src/services/wakanow/api-book.js";

async function main() {
  console.log("Searching for flights: Enugu → Lagos on 2026-04-19...");
  const searchResult = await searchFlightsApi({
    origin: "Enugu", destination: "Lagos", departureDate: "2026-04-19", maxResults: 5
  });

  console.log(`Found ${searchResult.resultCount} flights:`);
  for (const [i, f] of searchResult.results.entries()) {
    console.log(`  ${i + 1}. ${f.airline} ${f.departureTime}→${f.arrivalTime} ${f.priceText} (${f.stops})`);
  }

  const flight = searchResult.results[0];
  const passenger = generateTestPassenger(); // fully random
  console.log(`\nBooking flight 1: ${flight.airline}`);
  console.log(`Passenger: ${passenger.title} ${passenger.firstName} ${passenger.middleName} ${passenger.lastName} (${passenger.dateOfBirth})`);
  console.log(`Phone: ${passenger.phone}, Email: ${passenger.email}\n`);

  const bookResult = await bookFlightApi({
    searchKey: flight.searchKey!,
    flightId: flight.flightId!,
    deeplink: flight.deeplink,
    passenger
  });
  console.log("\nBooking result:", JSON.stringify(bookResult, null, 2));
}

main().catch(e => { console.error("FAILED:", e.message); if (e.details) console.error("Details:", e.details); });
