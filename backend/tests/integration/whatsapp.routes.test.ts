import assert from "node:assert/strict";

import { buildServer } from "../../src/app.js";
import { createInMemoryConversationRepository } from "../../src/domain/conversation/conversation.service.js";

const sentMessages: unknown[] = [];
const persistedMessages = new Set<string>();
const app = buildServer({
  whatsappVerifyToken: "verify-token",
  conversationRepository: createInMemoryConversationRepository(),
  messageRepository: {
    async recordInboundMessage(input) {
      assert.ok(input.conversationId.startsWith("conversation:"));
      if (persistedMessages.has(input.providerMessageId)) {
        return { wasCreated: false };
      }
      persistedMessages.add(input.providerMessageId);
      return { wasCreated: true };
    },
  },
  whatsappClient: {
    async sendMessage(input) {
      sentMessages.push(input);
    },
  },
});

const verify = await app.inject({
  method: "GET",
  url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
});

assert.equal(verify.statusCode, 200);
assert.equal(verify.body, "abc123");

const badVerify = await app.inject({
  method: "GET",
  url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
});

assert.equal(badVerify.statusCode, 403);

const inbound = await app.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.1",
                  from: "2348012345678",
                  timestamp: "1777449600",
                  type: "text",
                  text: { body: "I need a flight to Abuja tomorrow morning" },
                },
              ],
            },
          },
        ],
      },
    ],
  },
});

assert.equal(inbound.statusCode, 200);
assert.deepEqual(JSON.parse(inbound.body), { ok: true, received: 1 });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(sentMessages.length, 1);

const duplicate = await app.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.1",
                  from: "2348012345678",
                  timestamp: "1777449600",
                  type: "text",
                  text: { body: "I need a flight to Abuja tomorrow morning" },
                },
              ],
            },
          },
        ],
      },
    ],
  },
});

assert.equal(duplicate.statusCode, 200);
assert.deepEqual(JSON.parse(duplicate.body), { ok: true, received: 0 });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(sentMessages.length, 1);
await app.close();
console.log("whatsapp route tests passed");
