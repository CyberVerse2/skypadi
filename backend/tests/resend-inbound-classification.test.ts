
import { classifyInboundEmail } from "../src/workflows/inbound-email.workflow";
import { describe, expect, test } from "vitest";


describe("resend inbound classification", () => {
  const email = (overrides: { from?: string; subject?: string; text?: string }) => ({
    from: "Wakanow <noreply@wakanow.com>",
    subject: "Special travel offers this week",
    text: "Save on your next trip. This email only contains promotional fares.",
    ...overrides,
  });

  test.each([
    {
      name: "promotional email",
      input: email({}),
      expected: "other",
    },
    {
      name: "booking confirmation",
      input: email({
        subject: "Booking confirmation: LOS to ABV",
        text: "Your itinerary is attached.",
      }),
      expected: "booking_confirmation",
    },
  ])("classifies $name", ({ input, expected }) => {
    expect.hasAssertions();

    expect(classifyInboundEmail(input).classification).toBe(expected);
  });

  test("marks verification emails without leaking the OTP into logs or state", () => {
    expect.hasAssertions();
    const verification = classifyInboundEmail(
      email({
        subject: "Your Wakanow verification code",
        text: "Your verification code is 482913.",
      })
    );
    expect(verification.classification).toBe("verification_code");
    expect(verification.hasCode).toBe(true);
    expect("otp" in verification).toBe(false);
  });
});
