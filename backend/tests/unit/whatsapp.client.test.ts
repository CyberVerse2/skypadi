
import { createWhatsAppCloudClient } from "../../src/channels/whatsapp/whatsapp.client";
import { describe, expect, test, vi } from "vitest";


describe("unit whatsapp client", () => {
  test("whatsapp cloud client sends messages and read indicators through the current graph api", async () => {
    expect.hasAssertions();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response("{}", { status: 200 });
    });

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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.map((call) => call.url)).toEqual([
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
      "https://graph.facebook.com/v25.0/phone-number-id/messages",
    ]);
    expect(calls[0]?.body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "2348012345678",
      type: "text",
    });
    expect(calls[1]?.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.123",
    });
    expect(calls[2]?.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.456",
      typing_indicator: {
        type: "text",
      },
    });
  });

  test("includes provider error details when a Cloud API request fails", async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{\"error\":{\"message\":\"blocked\"}}", { status: 400 }),
    );
    const client = createWhatsAppCloudClient({
      accessToken: "token",
      phoneNumberId: "phone-number-id",
    });

    await expect(
      client.showTypingIndicator({ messageId: "wamid.456" }),
    ).rejects.toThrow(/WhatsApp Cloud API typing indicator failed: 400/);
  });
});
