/**
 * Test if we can:
 * 1. Build the search URL directly
 * 2. Follow the redirect to get the requestKey
 * 3. Call the flights API with that key
 * All without a browser.
 */

async function main() {
  // Step 1: Build the search URL (same format Wakanow uses)
  const itinerary = [{
    Ticketclass: "Y",
    Departure: "LOS",
    Destination: "ABV",
    DepartureDate: "4/25/2026",
    DepartureMetaData: {
      AirportCode: "LOS",
      Description: "Murtala Muhammed International Airport (LOS)",
      CityCountry: "Lagos, Nigeria",
      City: "Lagos",
      Country: "Nigeria",
      Priority: 9
    },
    DestinationMetaData: {
      AirportCode: "ABV",
      Description: "Nnamdi Azikwe International Airport (ABV)",
      CityCountry: "Abuja, Nigeria",
      City: "Abuja",
      Country: "Nigeria",
      Priority: 8
    }
  }];

  const params = new URLSearchParams({
    FlightSearchType: "OneWay",
    Ticketclass: "Y",
    FlexibleDateFlag: "false",
    Adults: "1",
    Children: "0",
    Infants: "0",
    Itineraries: JSON.stringify(itinerary),
    TargetCurrency: "NGN",
    LanguageCode: "en",
    GeographyId: "NG"
  });

  const searchUrl = `https://www.wakanow.com/flight/search?${params}`;
  console.log("Step 1: Following search URL redirect...");
  console.log("URL length:", searchUrl.length);

  // Follow redirect to get the requestKey
  const searchRes = await fetch(searchUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html"
    }
  });

  const finalUrl = searchRes.url;
  console.log("Redirected to:", finalUrl);

  // Extract requestKey from URL like /flight/listings/{key}
  const keyMatch = finalUrl.match(/listings\/([^?/]+)/);
  if (!keyMatch) {
    console.log("No request key found in URL. Status:", searchRes.status);
    console.log("Response headers:", Object.fromEntries(searchRes.headers.entries()));
    const body = await searchRes.text();
    console.log("Body preview:", body.slice(0, 500));
    return;
  }

  const requestKey = keyMatch[1];
  console.log("Request key:", requestKey);

  // Step 2: Call the flights API directly
  console.log("\nStep 2: Calling flights API...");
  const apiUrl = `https://flights.wakanow.com/api/flights/SearchV2/${requestKey}/NGN`;
  const start = Date.now();

  const apiRes = await fetch(apiUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Origin": "https://www.wakanow.com",
      "Referer": "https://www.wakanow.com/"
    }
  });

  const elapsed = Date.now() - start;
  console.log(`API response: ${apiRes.status} in ${elapsed}ms`);

  if (!apiRes.ok) {
    console.log("Error:", await apiRes.text());
    return;
  }

  const data = await apiRes.json() as any;
  console.log("HasResult:", data.HasResult);
  console.log("Total flights:", data.SearchFlightResults?.length ?? 0);

  // Show first 3 flights
  const flights = data.SearchFlightResults?.slice(0, 3) ?? [];
  for (const f of flights) {
    const combo = f.FlightCombination;
    const flight = combo?.Flights?.[0];
    const fare = f.Fares?.[0];
    if (flight) {
      console.log(`  ${flight.AirlineName} ${flight.DepartureTime} → ${flight.ArrivalTime} | ${fare?.Currency ?? ""} ${fare?.TotalFare ?? "?"}`);
    }
  }

  console.log(`\nTotal time: search URL redirect + API call`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
