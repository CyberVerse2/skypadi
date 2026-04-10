/**
 * Two approaches:
 * 1. Try calling flights.wakanow.com API directly to create a search
 * 2. Build search URL without double-encoding
 */
import { chromium } from "playwright";

async function main() {
  // Approach 1: Try POST to the search API directly
  console.log("=== Approach 1: Direct API call ===");
  const searchBody = {
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
  };

  // Try different API endpoints
  const endpoints = [
    "https://flights.wakanow.com/api/flights/Search",
    "https://flights.wakanow.com/api/flights/SearchV2",
    "https://flights.wakanow.com/api/flights/search",
  ];

  for (const url of endpoints) {
    console.log(`\nPOST ${url}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": "https://www.wakanow.com",
          "Referer": "https://www.wakanow.com/"
        },
        body: JSON.stringify(searchBody)
      });
      console.log(`  Status: ${res.status}`);
      const text = await res.text();
      console.log(`  Body: ${text.slice(0, 300)}`);
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Approach 2: Use Playwright but go directly to a properly constructed URL
  console.log("\n=== Approach 2: Properly encoded search URL via browser ===");
  const browser = await chromium.launch({ headless: true, args: ["--disable-http2"] });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  // Capture the SearchV2 call
  let searchApiUrl = "";
  let searchApiResponse = "";
  page.on("response", async (res) => {
    if (res.url().includes("flights.wakanow.com/api/flights/SearchV2")) {
      searchApiUrl = res.url();
      try {
        searchApiResponse = (await res.text()).slice(0, 500);
      } catch {}
    }
  });

  // Use page.goto with the URL that the Angular app constructs
  // The key insight: Angular reads query params and constructs the API call
  // We need the Itineraries param to NOT be double-encoded
  const itinerary = JSON.stringify([{
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
  }]);

  // Build URL manually to avoid double-encoding
  const searchUrl =
    "https://www.wakanow.com/flight/search?" +
    "FlightSearchType=OneWay&Ticketclass=Y&FlexibleDateFlag=false" +
    "&Adults=1&Children=0&Infants=0" +
    "&Itineraries=" + encodeURIComponent(itinerary) +
    "&TargetCurrency=NGN&LanguageCode=en&GeographyId=NG";

  console.log("Navigating...");
  const start = Date.now();
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for redirect to listings
  const redirected = await page.waitForURL(/listings/, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  const elapsed = Date.now() - start;
  console.log(`Redirected: ${redirected} in ${elapsed}ms`);
  console.log(`URL: ${page.url().slice(0, 100)}`);

  if (redirected) {
    // Extract the request key
    const key = page.url().match(/listings\/([^?/]+)/)?.[1];
    console.log(`Request key: ${key}`);

    // Wait for the SearchV2 API call
    await page.waitForTimeout(15_000);
    console.log(`\nSearchV2 API URL: ${searchApiUrl}`);
    console.log(`SearchV2 response: ${searchApiResponse}`);
  }

  await browser.close();
}

main().catch(console.error);
