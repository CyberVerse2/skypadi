import "dotenv/config";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { bookFlightApi } from "../src/services/wakanow/api-book.js";
import { generateTestPassenger } from "./test-passenger.js";

async function main() {
  const depart = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  console.log(`Searching for flights: Enugu → Lagos on ${depart}...`);
  const searchResult = await searchFlightsApi({
    origin: "Enugu", destination: "Lagos", departureDate: depart, maxResults: 5
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

main()
  .catch((e) => { console.error("FAILED:", e.message); if (e.details) console.error("Details:", e.details); process.exitCode = 1; })
  .finally(async () => {
    // Shared browser singleton in api-book.ts keeps Chrome alive across bookings.
    // Explicitly close it so Node can exit instead of hanging on an open handle.
    const { chromium } = await import("patchright");
    for (const b of chromium.connect ? [] : []) await b.close().catch(() => undefined);
    // Force exit — shared browser in api-book is a module-scope `let`; cleanest kill.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  });
