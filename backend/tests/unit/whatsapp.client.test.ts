import assert from "node:assert/strict";

import { createWhatsAppCloudClient } from "../../src/channels/whatsapp/whatsapp.client";
import { test } from "vitest";

test("whatsapp cloud client sends messages and read indicators through the current graph api", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const client = createWhatsAppCloudClient({
      accessToken: "token",
      phoneNumberId: "phone-number-id",
    });

    await client.sendMessage({
      to: "2348012345678",
      message: { type: "text", text: { body: "Hello" } },
    });
    await client.markMessageRead({ messageId: "wamid.123" });
    await client.showTypingIndicator({ messageId: "wamid.456" });

    assert.deepEqual(calls.map((call) => call.url), [
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
    ]);
    assert.deepEqual(calls[1]?.body, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.123",
    });
    assert.deepEqual(calls[2]?.body, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.456",
      typing_indicator: {
        type: "text",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
