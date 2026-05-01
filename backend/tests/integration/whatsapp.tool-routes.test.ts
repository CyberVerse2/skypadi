import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildServer } from "../../src/app";
import type { ConversationRecord, ConversationRepository } from "../../src/domain/conversation/conversation.types";
import type { ChatModel } from "../../src/tools/chat-agent";

const sentMessages: unknown[] = [];
const conversations = new Map<string, ConversationRecord>();
const savedConversationId = "11111111-1111-4111-8111-111111111111";
const savedUserId = "22222222-2222-4222-8222-222222222222";

const conversationRepository: ConversationRepository = {
  async findByPhoneNumber(phoneNumber) {
    return conversations.get(phoneNumber);
  },
  async save(conversation) {
    const saved = {
      ...conversation,
      id: savedConversationId,
      userId: savedUserId,
      draft: { ...conversation.draft },
    };
    conversations.set(conversation.phoneNumber, saved);
    return saved;
  },
};

const chatModel: ChatModel = async () => ({
  type: "reply",
  message: "Sure. Where are you flying from?",
});

const app = buildServer({
  whatsappVerifyToken: "verify-token",
  whatsappAppSecret: "secret",
  conversationRepository,
  messageRepository: {
    async recordInboundMessage(input) {
      assert.equal(input.conversationId, savedConversationId);
      return { wasCreated: true };
    },
  },
  whatsappClient: {
    async sendMessage(input) {
      sentMessages.push(input);
    },
  },
  chatModel,
  intentExtractor: {
    async extractTripIntent() {
      return {
        kind: "general_chat",
        reply: "This is the old workflow reply.",
      };
    },
  },
  flightSearchHandler: {
    async searchAndPresent() {
      return { type: "text", body: "unused" };
    },
  },
  bookingHandler: {
    async createFromFlightSelection() {
      return { type: "text", body: "unused" };
    },
    async collectPassengerDetails() {
      return undefined;
    },
  },
});

const body = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: "wamid.tool.1",
                from: "2348012345678",
                timestamp: "1777620000",
                type: "text",
                text: { body: "I want to travel" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
const response = await app.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: body,
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": signature,
  },
});

assert.equal(response.statusCode, 200);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(sentMessages.length, 1);
assert.deepEqual(sentMessages[0], {
  to: "2348012345678",
  message: {
    type: "text",
    text: { body: "Sure. Where are you flying from?" },
  },
});

await app.close();
console.log("whatsapp tool route tests passed");
