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

  // Capture ALL XHR/fetch requests — not just ones with "api" in URL
  const apiCalls: Array<{
    method: string;
    url: string;
    postData?: string;
    status?: number;
    contentType?: string;
    responseSize?: number;
    responsePreview?: string;
  }> = [];

  // Only capture JSON responses — skip analytics/tracking
  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] ?? "";

    // Skip google, facebook, analytics, optimonk, etc
    if (/google\.|facebook\.|fb\.|optimonk|clarity|analytics|gtm|doubleclick|bing\./i.test(url)) return;

    const req = res.request();
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;

    try {
      const body = await res.text();
      apiCalls.push({
        method: req.method(),
        url: url.slice(0, 200),
        postData: req.postData()?.slice(0, 500) ?? undefined,
        status: res.status(),
        contentType: ct.slice(0, 60),
        responseSize: body.length,
        responsePreview: body.slice(0, 300)
      });
    } catch {}
  });

  // Navigate to a known working listings URL from our previous search
  const listingsUrl = "https://www.wakanow.com/flight/listings/o_lIuUERLka7wAl8AMhRDg";
  console.log("Navigating to listings page...");
  await page.goto(listingsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for flight cards to appear
  await page.locator("div.flight-fare-detail-wrap").first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => console.log("No flight cards found"));

  await page.waitForTimeout(5_000);

  console.log("\n=== INTERCEPTED API CALLS ===\n");
  for (const call of apiCalls) {
    console.log(`${call.method} ${call.url}`);
    console.log(`  Content-Type: ${call.contentType} | Size: ${call.responseSize} | Status: ${call.status}`);
    if (call.postData) console.log(`  POST body: ${call.postData}`);
    console.log(`  Preview: ${call.responsePreview}`);
    console.log();
  }

  console.log(`Total: ${apiCalls.length} API calls`);
  await browser.close();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
