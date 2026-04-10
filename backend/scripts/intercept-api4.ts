/**
 * Intercept the exact flow: what API call generates the requestKey?
 * Monitor network from the Angular app search initiation.
 */
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-http2"] });
  const context = await browser.newContext({
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  // Capture requests that happen during the search URL → listings redirect
  page.on("response", async (res) => {
    const url = res.url();
    const req = res.request();

    // Only care about wakanow flight-related endpoints
    if (!url.includes("flights.wakanow.com") && !url.includes("wakanow.com/api") && !url.includes("wakanow.com/flight")) return;
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch" && req.resourceType() !== "document") return;

    const ct = res.headers()["content-type"] ?? "";
    console.log(`${req.method()} ${url.slice(0, 150)}`);
    console.log(`  Status: ${res.status()} | Type: ${ct.slice(0, 40)}`);
    if (req.postData()) console.log(`  POST: ${req.postData()!.slice(0, 300)}`);

    if (ct.includes("json")) {
      try {
        const body = await res.text();
        console.log(`  Size: ${body.length} | Preview: ${body.slice(0, 200)}`);
      } catch {}
    }
    console.log();
  });

  // Build search URL
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
  console.log("Navigating to search URL...\n");
  const start = Date.now();

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for redirect to listings
  await page.waitForURL(/listings/, { timeout: 60_000 }).catch(() => {
    console.log("Did not redirect to listings. Current URL:", page.url());
  });

  const elapsed = Date.now() - start;
  console.log(`\nRedirected to: ${page.url()}`);
  console.log(`Time to listings: ${elapsed}ms`);

  // Wait a bit more for the API call
  await page.waitForTimeout(10_000);

  await browser.close();
}

main().catch(console.error);
