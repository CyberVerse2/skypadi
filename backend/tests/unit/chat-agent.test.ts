import assert from "node:assert/strict";

import { decideChatActionWithModel } from "../../src/tools/chat-agent";

const baseDecisionInput = {
  userText: "Find Lagos to Enugu next Saturday",
  now: new Date("2026-05-01T09:00:00.000Z"),
  context: {
    conversationId: "conversation-1",
    userId: "user-1",
    phoneNumber: "2348012345678",
  },
};

const searchDecision = await decideChatActionWithModel(
  async () => ({
    type: "tool",
    tool: "searchFlights",
    input: {
      origin: "LOS",
      destination: "ENU",
      departureDate: "2026-05-09",
      adults: 1,
    },
  }),
  baseDecisionInput
);

assert.equal(searchDecision.type, "tool");
if (searchDecision.type === "tool") {
  assert.equal(searchDecision.tool, "searchFlights");
  assert.equal(searchDecision.input.destination, "ENU");
}

const replyDecision = await decideChatActionWithModel(
  async () => ({
    type: "reply",
    message: "Sure. Which city are you flying from?",
  }),
  { ...baseDecisionInput, userText: "I want to travel" }
);

assert.deepEqual(replyDecision, {
  type: "reply",
  message: "Sure. Which city are you flying from?",
});

const modelShapeSearchDecision = await decideChatActionWithModel(
  async () => ({
    action: "searchFlights",
    message: null,
    searchFlightsInput: {
      origin: "LOS",
      destination: "ENU",
      departureDate: "2026-05-09",
      departureWindow: "morning",
      returnDate: null,
      adults: 1,
    },
    collectTripDetailsInput: null,
    sendControlledReplyInput: null,
    startBookingJobInput: null,
  }),
  baseDecisionInput
);

assert.deepEqual(modelShapeSearchDecision, {
  type: "tool",
  tool: "searchFlights",
  input: {
    origin: "LOS",
    destination: "ENU",
    departureDate: "2026-05-09",
    departureWindow: "morning",
    adults: 1,
  },
});

const modelShapeCollectTripDetailsDecision = await decideChatActionWithModel(
  async () => ({
    action: "collectTripDetails",
    message: null,
    searchFlightsInput: null,
    collectTripDetailsInput: {
      origin: "LOS",
      destination: null,
      departureDate: "2026-05-09",
      departureWindow: "morning",
      returnDate: null,
      adults: 1,
    },
    sendControlledReplyInput: null,
    startBookingJobInput: null,
  }),
  baseDecisionInput
);

assert.deepEqual(modelShapeCollectTripDetailsDecision, {
  type: "tool",
  tool: "collectTripDetails",
  input: {
    origin: "LOS",
    departureDate: "2026-05-09",
    departureWindow: "morning",
    adults: 1,
  },
});

const modelShapeControlledReplyDecision = await decideChatActionWithModel(
  async () => ({
    action: "sendControlledReply",
    message: null,
    searchFlightsInput: null,
    collectTripDetailsInput: null,
    sendControlledReplyInput: { key: "skypadi_intro" },
    startBookingJobInput: null,
  }),
  baseDecisionInput
);

assert.deepEqual(modelShapeControlledReplyDecision, {
  type: "tool",
  tool: "sendControlledReply",
  input: { key: "skypadi_intro" },
});

const modelShapeReplyDecision = await decideChatActionWithModel(
  async () => ({
    action: "reply",
    message: "Sure. Which city are you flying from?",
    searchFlightsInput: null,
    collectTripDetailsInput: null,
    sendControlledReplyInput: null,
    startBookingJobInput: null,
  }),
  baseDecisionInput
);

assert.deepEqual(modelShapeReplyDecision, {
  type: "reply",
  message: "Sure. Which city are you flying from?",
});

const longReply = await decideChatActionWithModel(
  async () => ({
    type: "reply",
    message: "A. B. C. D.",
  }),
  { ...baseDecisionInput, userText: "Explain everything" }
);

assert.equal(longReply.type, "reply");
if (longReply.type === "reply") {
  assert.equal(longReply.message, "A. B. C.");
}

await assert.rejects(
  decideChatActionWithModel(
    async () => ({
      action: "searchFlights",
      message: null,
      searchFlightsInput: null,
      collectTripDetailsInput: null,
      sendControlledReplyInput: null,
      startBookingJobInput: null,
    }),
    baseDecisionInput
  ),
  /searchFlights action requires searchFlightsInput/
);

await assert.rejects(
  decideChatActionWithModel(
    async () => ({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "LOS",
        destination: "ENU",
        departureDate: "2026-05-09",
      },
    }),
    baseDecisionInput
  )
);

await assert.rejects(
  decideChatActionWithModel(
    async () => ({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "LO",
        destination: "ENU",
        departureDate: "2026-05-09",
        adults: 1,
      },
    }),
    baseDecisionInput
  )
);

await assert.rejects(
  decideChatActionWithModel(
    async () => ({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "LOS",
        destination: "ENU",
        departureDate: "2026-05-09",
        returnDate: "2026-05-08",
        adults: 1,
      },
    }),
    baseDecisionInput
  )
);

console.log("chat agent tests passed");
