import assert from "node:assert/strict";

import { getReceivedEmail, type ResendClient } from "../../src/integrations/resend/resend.client.js";

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

assert.deepEqual(email, {
  id: "email_123",
  from: "Wakanow <noreply@wakanow.com>",
  to: ["book_abc@bookings.wakanow.com"],
  subject: "Your Wakanow verification code",
  text: "Use 493821.",
  html: undefined,
  createdAt: "2026-04-29T10:04:00.000Z",
  messageId: "msg_123",
});

await assert.rejects(
  () =>
    getReceivedEmail(
      {
        emails: {
          receiving: {
            get: async () => ({ data: null, error: { message: "missing" } }),
          },
        },
      } as unknown as ResendClient,
      "email_missing"
    ),
  /Resend received email fetch failed/
);

console.log("resend client tests passed");
