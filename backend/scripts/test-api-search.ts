async function main() {
  const start = Date.now();

  // Step 1: Create search → get request key
  console.log("Step 1: Creating search...");
  const searchRes = await fetch("https://flights.wakanow.com/api/flights/Search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://www.wakanow.com",
      "Referer": "https://www.wakanow.com/"
    },
    body: JSON.stringify({
      FlightSearchType: "OneWay",
      Ticketclass: "Y",
      FlexibleDateFlag: false,
      Adults: 1,
      Children: 0,
      Infants: 0,
      GeographyId: "NG",
      TargetCurrency: "NGN",
      LanguageCode: "en",
      Itineraries: [{
        Ticketclass: "Y",
        Departure: "LOS",
        Destination: "ABV",
        DepartureDate: "4/25/2026"
      }]
    })
  });

  const requestKey = (await searchRes.text()).replace(/"/g, "");
  console.log(`Request key: ${requestKey} (${Date.now() - start}ms)`);

  // Step 2: Poll for results (may need a moment for results to be ready)
  console.log("\nStep 2: Fetching flight results...");

  let data: any = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const apiRes = await fetch(
      `https://flights.wakanow.com/api/flights/SearchV2/${requestKey}/NGN`,
      {
        headers: {
          "Accept": "application/json",
          "Origin": "https://www.wakanow.com",
          "Referer": "https://www.wakanow.com/"
        }
      }
    );

    data = await apiRes.json();
    const count = data.SearchFlightResults?.length ?? 0;
    console.log(`  Attempt ${attempt}: ${count} flights (${Date.now() - start}ms)`);

    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!data?.SearchFlightResults?.length) {
    console.log("No results found.");
    return;
  }

  // Show results
  const total = Date.now() - start;
  console.log(`\n=== ${data.SearchFlightResults.length} flights found in ${total}ms ===\n`);

  for (const result of data.SearchFlightResults.slice(0, 5)) {
    const flight = result.FlightCombination?.Flights?.[0];
    const fare = result.Fares?.[0];
    if (!flight) continue;

    console.log(
      `${flight.AirlineName.padEnd(20)} ` +
      `${flight.DepartureTime.split("T")[1]?.slice(0, 5)} → ${flight.ArrivalTime.split("T")[1]?.slice(0, 5)} ` +
      `| ${fare?.Currency ?? ""} ${fare?.BaseFare ?? "?"} + ${fare?.TotalTax ?? "?"} tax = ${fare?.TotalFare ?? "?"}`
    );
  }

  // Show the deeplink URL for booking
  console.log(`\nBooking deeplink: https://www.wakanow.com/flight/listings/${requestKey}`);
}

main().catch(console.error);
