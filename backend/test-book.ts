import { searchWakanowFlights } from "./src/services/wakanow/search.js";
import { bookWakanowFlight } from "./src/services/wakanow/book.js";

async function main() {
  // Step 1: Search for flights
  console.log("=== SEARCHING FOR FLIGHTS ===");
  const searchResult = await searchWakanowFlights(
    {
      origin: "Lagos",
      destination: "Abuja",
      departureDate: "2026-04-25",
      passengers: { adults: 1 }
    },
    {
      onTrace: (e) =>
        console.log(`[${e.step}] ${e.message}`, e.data ? JSON.stringify(e.data) : "")
    }
  );

  console.log(`\nFound ${searchResult.results.length} flights`);
  if (searchResult.results.length === 0) {
    console.log("No flights found, aborting.");
    process.exit(1);
  }

  const flight = searchResult.results[0];
  console.log(`Flight 0: ${flight.airline} ${flight.departureTime} → ${flight.arrivalTime} — ${flight.priceText}`);
  console.log(`Deeplink: ${flight.deeplink}`);

  // Step 2: Book the first flight
  console.log("\n=== BOOKING FLIGHT ===");
  const bookResult = await bookWakanowFlight(
    {
      deeplink: flight.deeplink,
      flightIndex: 0,
      passengers: [
        {
          title: "Mr",
          firstName: "Celestine",
          lastName: "Ejiofor",
          dateOfBirth: "1995-06-15",
          nationality: "Nigerian",
          gender: "Male",
          phone: "08012345678",
          email: "ejioforcelestine77@gmail.com"
        }
      ],
      headless: false,
      timeoutMs: 120_000
    },
    {
      onTrace: (e) =>
        console.log(`[${e.step}] ${e.message}`, e.data ? JSON.stringify(e.data) : "")
    }
  );

  console.log("\n=== BOOKING RESULT ===");
  console.log("Step:", bookResult.currentStep);
  console.log("URL:", bookResult.currentUrl);
  console.log("Page content (first 500):", bookResult.pageContent.slice(0, 500));
}

main().catch((err) => {
  console.error("\n❌ FAILED\n", err.message, err.details ?? "");
  process.exit(1);
});
