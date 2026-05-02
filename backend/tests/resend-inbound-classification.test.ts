
import { classifyInboundEmail } from "../src/workflows/inbound-email.workflow";
import { describe, expect, test } from "vitest";


describe("resend inbound classification", () => {
  test("resend inbound classification", async () => {
    function email(overrides: { from?: string; subject?: string; text?: string }) {
      return {
        from: "Wakanow <noreply@wakanow.com>",
        subject: "Special travel offers this week",
        text: "Save on your next trip. This email only contains promotional fares.",
        ...overrides,
      };
    }

    expect(classifyInboundEmail(email({})).classification).toBe("other");

    const verification = classifyInboundEmail(
      email({
        subject: "Your Wakanow verification code",
        text: "Your verification code is 482913.",
      })
    );
    expect(verification.classification).toBe("verification_code");
    expect(verification.hasCode).toBe(true);
    expect("otp" in verification).toBe(false);

    expect(classifyInboundEmail(
        email({
          subject: "Booking confirmation: LOS to ABV",
          text: "Your itinerary is attached.",
        })
      ).classification).toBe("booking_confirmation");

    console.log("Resend inbound classification tests passed.");
  });
});
