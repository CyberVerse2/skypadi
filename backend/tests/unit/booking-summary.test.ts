
import { bookingSummaryPassengerFlowBody } from "../../src/workflows/booking-summary";
import { describe, expect, test } from "vitest";


describe("unit booking summary", () => {
  test("booking summary", async () => {
    const body = bookingSummaryPassengerFlowBody({
      passengerPrompt: "I need the passenger details to continue.",
      summary: {
        route: "Lagos → Abuja",
        flight: "Ibom Air, 8:45 AM tomorrow",
        baggage: "standard cabin + checked baggage included",
        fare: 158000,
        currency: "NGN",
        skypadiFee: 3000,
      },
    });

    expect(body).toMatch(/^Great\. Here’s your booking summary:/);
    expect(body).toMatch(/Route: Lagos → Abuja/);
    expect(body).toMatch(/Flight: Ibom Air, 8:45 AM tomorrow/);
    expect(body).toMatch(/Fare: ₦158,000/);
    expect(body).toMatch(/Skypadi fee: ₦3,000/);
    expect(body).toMatch(/Total: ₦161,000/);
    expect(body).toMatch(/I need the passenger details to continue\.$/);

    console.log("booking summary tests passed");
  });
});
