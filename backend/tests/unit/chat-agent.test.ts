import assert from "node:assert/strict";

import { decideChatActionWithModel } from "../../src/tools/chat-agent";

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
  {
    userText: "Find Lagos to Enugu next Saturday",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
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
  {
    userText: "I want to travel",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
);

assert.deepEqual(replyDecision, {
  type: "reply",
  message: "Sure. Which city are you flying from?",
});

const longReply = await decideChatActionWithModel(
  async () => ({
    type: "reply",
    message: "A. B. C. D.",
  }),
  {
    userText: "Explain everything",
    now: new Date("2026-05-01T09:00:00.000Z"),
    context: {
      conversationId: "conversation-1",
      userId: "user-1",
      phoneNumber: "2348012345678",
    },
  }
);

assert.equal(longReply.type, "reply");
if (longReply.type === "reply") {
  assert.equal(longReply.message, "A. B. C.");
}

console.log("chat agent tests passed");
