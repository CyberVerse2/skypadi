import { flightSearchRequestSchema } from "../src/schemas/flight-search.js";
import { searchWakanowFlights } from "../src/services/wakanow/search.js";

const payload = flightSearchRequestSchema.parse({
  origin: "LOS",
  destination: "DXB",
  departureDate: "2026-06-10",
  returnDate: "2026-06-17",
  headless: true,
  maxResults: 5
});

const result = await searchWakanowFlights(payload, {
  onTrace: (event) => {
    const details = event.data ? ` ${JSON.stringify(event.data)}` : "";
    console.error(`[trace ${event.timestamp}] ${event.step} ${event.message}${details}`);
  }
});

console.log(JSON.stringify(result, null, 2));
