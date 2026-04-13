import "dotenv/config";
import { searchFlightsApi } from "../src/services/wakanow/api-search.js";
import { chromium } from "playwright";

const BOOKING_API_BASE = "https://booking.wakanow.com/api/booking";
const FLIGHTS_API_BASE = "https://flights.wakanow.com/api/flights";
const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://www.wakanow.com/",
  "Origin": "https://www.wakanow.com"
};

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: { connect:()=>{}, sendMessage:()=>{}, onMessage:{addListener:()=>{}} }, loadTimes:()=>({}), csi:()=>({}) };
`;

async function main() {
  // Search
  console.log("Searching...");
  const result = await searchFlightsApi({ origin: "Enugu", destination: "Lagos", departureDate: "2026-04-18", maxResults: 5 });
  const flight = result.results[0];
  console.log(`Flight: ${flight.airline} ${flight.priceText}, key=${flight.searchKey}, id=${flight.flightId}`);

  // Get cookies from browser
  console.log("\nGetting Imperva cookies...");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    locale: "en-NG", timezoneId: "Africa/Lagos",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  await context.addInitScript(STEALTH);
  const page = await context.newPage();

  // Visit booking.wakanow.com to solve JS challenge
  await page.goto("https://www.wakanow.com/en-ng", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3_000);

  // Also visit booking subdomain
  await page.goto("https://booking.wakanow.com/api/booking/BookingConfirmation/Get/0", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  console.log(`Got ${cookies.length} cookies`);
  console.log(`Wakanow cookies: ${cookies.filter(c => c.domain.includes("wakanow")).map(c => c.name).join(", ")}`);

  await browser.close();

  // Now use cookies for API calls
  const h = { ...HEADERS, Cookie: cookieStr };

  // Step 1: Select
  console.log("\nStep 1: Select...");
  const selectRes = await fetch(`${FLIGHTS_API_BASE}/Select/`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ SearchKey: flight.searchKey, TargetCurrency: "NGN", FlightId: flight.flightId })
  });
  const selectData = await selectRes.json() as any;
  const bookingId = selectData.BookingId;
  const bookingData = selectData.SelectData;
  console.log(`BookingId: ${bookingId}, HasSelectData: ${!!bookingData}`);

  if (!bookingId || !bookingData) {
    console.log("Select response:", JSON.stringify(selectData).slice(0, 500));
    return;
  }

  // Step 2: Validate
  console.log("\nStep 2: Validate...");
  const dobDate = new Date("1990-01-15T12:00:00");
  const dobFormatted = dobDate.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const age = Math.floor((Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

  const validateBody = {
    PassengerDetails: [{
      PassengerType: "Adult", Email: "test@example.com", PhoneNumber: "+2348012345678",
      Title: "Mr", FirstName: "Test", LastName: "User", MiddleName: "", Gender: "Male",
      DateOfBirth: dobFormatted, Age: age,
      ExpiryDate: "", PassportNumber: "", PassportIssuingAuthority: "", PassportIssueCountryCode: "",
      PassengerReferenceNumber: "", TimeOfTravel: "", CountryCode: "NG", Country: "Nigeria",
      Address: "", City: "", SelectedBaggages: [], SelectedSeats: [], WakaPointId: ""
    }],
    BookingItemModels: [{ ProductType: "Flight", BookingData: bookingData }]
  };

  const validateRes = await fetch(`${BOOKING_API_BASE}/Booking/Validate`, {
    method: "POST", headers: h, body: JSON.stringify(validateBody)
  });
  console.log(`Validate: ${validateRes.status}`);
  const validateText = await validateRes.text();
  console.log(`Validate response: ${validateText.slice(0, 300)}`);

  if (!validateRes.ok) return;

  // Step 3: GeneratePNR
  console.log("\nStep 3: GeneratePNR...");
  const pnrRes = await fetch(`${BOOKING_API_BASE}/Booking/GeneratePNR/${bookingId}`, { headers: h });
  console.log(`PNR: ${pnrRes.status}`);

  // Step 4: MakePayment
  console.log("\nStep 4: MakePayment...");
  const payRes = await fetch(`${BOOKING_API_BASE}/Payment/MakePayment`, {
    method: "POST", headers: h,
    body: JSON.stringify({
      BookingId: bookingId,
      CallbackUrl: `https://www.wakanow.com/en-ng/booking/${bookingId}/confirmation?products=Flight`,
      PaymentOptionId: 2, PaymentMethodId: 100,
      BillingAddress: { CardHolderName: "Test  User", Address: "", ZipCode: "", City: "", State: null, Country: "NG" },
      IsCorporateCheckout: false
    })
  });
  console.log(`Payment: ${payRes.status}`);
  if (payRes.ok) {
    const payData = await payRes.json() as any;
    const model = payData?.PaymentResponseModel;
    console.log(`Price: ₦${model?.TotalPrice?.Amount}`);
    const bankOpt = model?.PaymentOptions?.find((o: any) => o.Name?.includes("Bank"));
    if (bankOpt) {
      const desc = bankOpt.PaymentMethods[0]?.PaymentDescription ?? "";
      const accts = desc.match(/Account Number<\/p>\s*<p[^>]*>(\d+)<\/p>/gi);
      console.log(`Bank accounts found: ${accts?.length ?? 0}`);
    }
  }

  // Step 5: AddPayment
  await fetch(`${BOOKING_API_BASE}/Payment/AddPayment`, {
    method: "POST", headers: h, body: JSON.stringify({ BookingId: bookingId })
  }).catch(() => {});

  console.log("\nDONE");
}

main().catch(console.error);
