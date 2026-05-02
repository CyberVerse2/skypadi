
import { mapUiIntentToWhatsAppMessage } from "../../src/channels/whatsapp/whatsapp.mapper";
import { describe, expect, test } from "vitest";


describe("unit whatsapp mapper", () => {
  test("whatsapp mapper", async () => {
    expect.hasAssertions();
    const originList = mapUiIntentToWhatsAppMessage({
      type: "origin_list",
      body: "Sure. Where are you flying from?",
      rows: [
        { id: "origin:LOS", title: "Lagos", description: "Murtala Muhammed Airport" },
        { id: "origin:ABV", title: "Abuja", description: "Nnamdi Azikiwe Airport" },
      ],
    });

    expect(originList.type).toBe("interactive");
    expect(originList.interactive.type).toBe("list");
    expect(originList.interactive.action.sections[0].rows[0].id).toBe("origin:LOS");

    const tripButtons = mapUiIntentToWhatsAppMessage({
      type: "reply_buttons",
      body: "Is this one-way or return?",
      buttons: [
        { id: "trip_type:one_way", title: "One-way" },
        { id: "trip_type:return", title: "Return" },
      ],
    });

    expect(tripButtons.interactive.type).toBe("button");
    expect(tripButtons.interactive.action.buttons[1].reply.id).toBe("trip_type:return");

    const ctaButton = mapUiIntentToWhatsAppMessage({
      type: "cta_button",
      body: "I found the best morning option.",
      button: { id: "flight:123", title: "Book this" },
    });

    expect(ctaButton).toEqual({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "I found the best morning option." },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "flight:123", title: "Book this" },
            },
          ],
        },
      },
    });

    const textMessage = mapUiIntentToWhatsAppMessage({
      type: "text",
      body: "I found a few flights for you.",
    });

    expect(textMessage).toEqual({
      type: "text",
      text: { body: "I found a few flights for you." },
    });

    const documentMessage = mapUiIntentToWhatsAppMessage({
      type: "document",
      body: "Here is your itinerary.",
      documentUrl: "https://example.com/itinerary.pdf",
      filename: "itinerary.pdf",
    });

    expect(documentMessage).toEqual({
      type: "document",
      document: {
        link: "https://example.com/itinerary.pdf",
        filename: "itinerary.pdf",
        caption: "Here is your itinerary.",
      },
    });

    const passengerFlow = mapUiIntentToWhatsAppMessage({
      type: "passenger_details_flow",
      body: "Great choice. I need the passenger details to continue.",
      buttonText: "Enter details",
      flowId: "flow_123",
      flowToken: "booking_123",
      data: { bookingId: "booking_123" },
    });

    expect(passengerFlow.type).toBe("interactive");
    expect(passengerFlow.interactive.type).toBe("flow");
    expect(passengerFlow.interactive.action.parameters.flow_id).toBe("flow_123");
    expect(passengerFlow.interactive.action.parameters.flow_token).toBe("booking_123");

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "origin_list",
          body: "Sure. Where are you flying from?",
          rows: [],
        })).toThrow(/at least 1 row/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "reply_buttons",
          body: "Is this one-way or return?",
          buttons: [],
        })).toThrow(/at least 1 button/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "reply_buttons",
          body: "Choose an option.",
          buttons: [
            { id: "trip_type:one_way", title: "One-way" },
            { id: "trip_type:return", title: "Return" },
            { id: "trip_type:multi_city", title: "Multi-city" },
            { id: "trip_type:flexible", title: "Flexible" },
          ],
        })).toThrow(/at most 3 buttons/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "cta_button",
          body: "Choose an option.",
          button: { id: "book", title: "x".repeat(21) },
        })).toThrow(/CTA button title.*20 characters/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "origin_list",
          body: "Sure. Where are you flying from?",
          rows: Array.from({ length: 11 }, (_, index) => ({
            id: `origin:${index}`,
            title: `City ${index}`,
          })),
        })).toThrow(/at most 10 rows/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "origin_list",
          body: "Sure. Where are you flying from?",
          rows: [{ id: "origin:LOS", title: "Lagos".repeat(5) }],
        })).toThrow(/row .*title.*24 characters/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "reply_buttons",
          body: "Is this one-way or return?",
          buttons: [{ id: "   ", title: "One-way" }],
        })).toThrow(/button .*id.*blank/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "text",
          body: "   ",
        })).toThrow(/body.*blank/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "text",
          body: "x".repeat(4097),
        })).toThrow(/text body.*4096 characters/);

    expect(() =>
        mapUiIntentToWhatsAppMessage({
          type: "document",
          body: "x".repeat(1025),
          documentUrl: "https://example.com/itinerary.pdf",
          filename: "itinerary.pdf",
        })).toThrow(/document body.*1024 characters/);
  });
});
