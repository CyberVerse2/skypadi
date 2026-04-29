import assert from "node:assert/strict";

import { mapUiIntentToWhatsAppMessage } from "../../src/channels/whatsapp/whatsapp.mapper.js";

const originList = mapUiIntentToWhatsAppMessage({
  type: "origin_list",
  body: "Sure. Where are you flying from?",
  rows: [
    { id: "origin:LOS", title: "Lagos", description: "Murtala Muhammed Airport" },
    { id: "origin:ABV", title: "Abuja", description: "Nnamdi Azikiwe Airport" },
  ],
});

assert.equal(originList.type, "interactive");
assert.equal(originList.interactive.type, "list");
assert.equal(originList.interactive.action.sections[0].rows[0].id, "origin:LOS");

const tripButtons = mapUiIntentToWhatsAppMessage({
  type: "reply_buttons",
  body: "Is this one-way or return?",
  buttons: [
    { id: "trip_type:one_way", title: "One-way" },
    { id: "trip_type:return", title: "Return" },
  ],
});

assert.equal(tripButtons.interactive.type, "button");
assert.equal(tripButtons.interactive.action.buttons[1].reply.id, "trip_type:return");

const textMessage = mapUiIntentToWhatsAppMessage({
  type: "text",
  body: "I found a few flights for you.",
});

assert.deepEqual(textMessage, {
  type: "text",
  text: { body: "I found a few flights for you." },
});

const documentMessage = mapUiIntentToWhatsAppMessage({
  type: "document",
  body: "Here is your itinerary.",
  documentUrl: "https://example.com/itinerary.pdf",
  filename: "itinerary.pdf",
});

assert.deepEqual(documentMessage, {
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

assert.equal(passengerFlow.type, "interactive");
assert.equal(passengerFlow.interactive.type, "flow");
assert.equal(passengerFlow.interactive.action.parameters.flow_id, "flow_123");
assert.equal(passengerFlow.interactive.action.parameters.flow_token, "booking_123");

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "origin_list",
      body: "Sure. Where are you flying from?",
      rows: [],
    }),
  /at least 1 row/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "reply_buttons",
      body: "Is this one-way or return?",
      buttons: [],
    }),
  /at least 1 button/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "reply_buttons",
      body: "Choose an option.",
      buttons: [
        { id: "trip_type:one_way", title: "One-way" },
        { id: "trip_type:return", title: "Return" },
        { id: "trip_type:multi_city", title: "Multi-city" },
        { id: "trip_type:flexible", title: "Flexible" },
      ],
    }),
  /at most 3 buttons/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "origin_list",
      body: "Sure. Where are you flying from?",
      rows: Array.from({ length: 11 }, (_, index) => ({
        id: `origin:${index}`,
        title: `City ${index}`,
      })),
    }),
  /at most 10 rows/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "origin_list",
      body: "Sure. Where are you flying from?",
      rows: [{ id: "origin:LOS", title: "Lagos".repeat(5) }],
    }),
  /row .*title.*24 characters/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "reply_buttons",
      body: "Is this one-way or return?",
      buttons: [{ id: "   ", title: "One-way" }],
    }),
  /button .*id.*blank/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "text",
      body: "   ",
    }),
  /body.*blank/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "text",
      body: "x".repeat(4097),
    }),
  /text body.*4096 characters/
);

assert.throws(
  () =>
    mapUiIntentToWhatsAppMessage({
      type: "document",
      body: "x".repeat(1025),
      documentUrl: "https://example.com/itinerary.pdf",
      filename: "itinerary.pdf",
    }),
  /document body.*1024 characters/
);

console.log("whatsapp mapper tests passed");
