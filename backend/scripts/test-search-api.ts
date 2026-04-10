import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  console.log("Searching Enugu → Abuja via API...");
  const result = await searchFlightsApi({ origin: "Enugu", destination: "Abuja", departureDate: "2026-04-19", maxResults: 5 });
  console.log(`Found ${result.resultCount} flights:\n`);
  for (const f of result.results) {
    console.log(`  ${f.airline} | ${f.departureTime}→${f.arrivalTime} | ${f.duration} | ${f.stops} | ${f.priceText}`);
  }
}

main().catch(e => console.error("ERROR:", e.message));
