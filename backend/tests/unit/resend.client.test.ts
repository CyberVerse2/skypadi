
import { getReceivedEmail, type ResendClient } from "../../src/integrations/resend/resend.client";
import { describe, expect, test } from "vitest";


describe("unit resend client", () => {
  test("resend client", async () => {
    const email = await getReceivedEmail(
      {
        emails: {
          receiving: {
            get: async (emailId: string) => ({
              data: {
                id: emailId,
                from: "Wakanow <noreply@wakanow.com>",
                to: ["book_abc@bookings.wakanow.com"],
                subject: "Your Wakanow verification code",
                text: "Use 493821.",
                html: null,
                created_at: "2026-04-29T10:04:00.000Z",
                message_id: "msg_123",
              },
              error: null,
            }),
          },
        },
      } as unknown as ResendClient,
      "email_123"
    );

    expect(email).toEqual({
      id: "email_123",
      from: "Wakanow <noreply@wakanow.com>",
      to: ["book_abc@bookings.wakanow.com"],
      subject: "Your Wakanow verification code",
      text: "Use 493821.",
      html: undefined,
      createdAt: "2026-04-29T10:04:00.000Z",
      messageId: "msg_123",
    });

    await expect(
      getReceivedEmail(
        {
          emails: {
            receiving: {
              get: async () => ({ data: null, error: { message: "missing" } }),
            },
          },
        } as unknown as ResendClient,
        "email_missing",
      ),
    ).rejects.toThrow(/Resend received email fetch failed/);

    console.log("resend client tests passed");
  });
});
