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

  // Intercept all XHR/fetch requests
  const apiCalls: Array<{ method: string; url: string; postData?: string; status?: number; responsePreview?: string }> = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("api") || url.includes("flight") || url.includes("search") || url.includes("listing")) {
      if (req.resourceType() === "xhr" || req.resourceType() === "fetch") {
        apiCalls.push({
          method: req.method(),
          url,
          postData: req.postData() ?? undefined
        });
      }
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] ?? "";
    if ((url.includes("api") || url.includes("flight") || url.includes("listing")) && ct.includes("json")) {
      const entry = apiCalls.find((c) => c.url === url && !c.status);
      if (entry) {
        entry.status = res.status();
        try {
          const body = await res.text();
          entry.responsePreview = body.slice(0, 500);
        } catch {}
      }
    }
  });

  // Navigate to search results directly using the URL pattern we know works
  const searchUrl = new URL("https://www.wakanow.com/flight/search");
  searchUrl.searchParams.set("FlightSearchType", "OneWay");
  searchUrl.searchParams.set("Ticketclass", "Y");
  searchUrl.searchParams.set("FlexibleDateFlag", "false");
  searchUrl.searchParams.set("Adults", "1");
  searchUrl.searchParams.set("Children", "0");
  searchUrl.searchParams.set("Infants", "0");
  searchUrl.searchParams.set("TargetCurrency", "NGN");
  searchUrl.searchParams.set("LanguageCode", "en");
  searchUrl.searchParams.set("GeographyId", "NG");

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
      Country: "Nigeria"
    },
    DestinationMetaData: {
      AirportCode: "ABV",
      Description: "Nnamdi Azikwe International Airport (ABV)",
      CityCountry: "Abuja, Nigeria",
      City: "Abuja",
      Country: "Nigeria"
    }
  }];

  searchUrl.searchParams.set("Itineraries", JSON.stringify(itinerary));

  console.log("Navigating to search URL...");
  console.log(searchUrl.toString().slice(0, 200) + "...");

  await page.goto(searchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for redirect to listings page
  await page.waitForURL(/listings/, { timeout: 60_000 }).catch(() => {});
  console.log("Current URL:", page.url());

  // Wait for API calls to come in
  await page.waitForTimeout(15_000);

  console.log("\n=== API CALLS INTERCEPTED ===");
  for (const call of apiCalls) {
    console.log(`\n${call.method} ${call.url}`);
    if (call.postData) console.log("  POST:", call.postData.slice(0, 300));
    if (call.status) console.log("  Status:", call.status);
    if (call.responsePreview) console.log("  Response:", call.responsePreview);
  }

  console.log(`\nTotal API calls: ${apiCalls.length}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
