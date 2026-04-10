import { searchFlightsApi } from "../src/services/wakanow/api-search.js";

async function main() {
  const dates = [
    "2026-04-13", "2026-04-14", "2026-04-15",
    "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"
  ];

  const CONCURRENCY = 2;
  console.log(`Searching 7 days with concurrency=${CONCURRENCY}...`);
  const start = Date.now();

  const results: Awaited<ReturnType<typeof searchFlightsApi>>[] = [];
  for (let i = 0; i < dates.length; i += CONCURRENCY) {
    const batch = dates.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (date) => {
        const t0 = Date.now();
        try {
          const r = await searchFlightsApi({ origin: "Enugu", destination: "Lagos", departureDate: date, maxResults: 5 });
          console.log(`  ${date}: ${r.resultCount} flights in ${Date.now() - t0}ms`);
          return r;
        } catch (e: any) {
          console.log(`  ${date}: FAILED (${e.message}) in ${Date.now() - t0}ms`);
          return null;
        }
      })
    );
    results.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null));
  }

  const total = Date.now() - start;
  const allFlights = results.reduce((sum, r) => sum + r.resultCount, 0);
  console.log(`\nTotal: ${allFlights} flights across 7 days in ${total}ms`);
}

main().catch(console.error);
