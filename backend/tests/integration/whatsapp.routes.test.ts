import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildServer } from "../../src/app";
import type {
  ConversationRecord,
  ConversationRepository,
} from "../../src/domain/conversation/conversation.types";

const sentMessages: unknown[] = [];
let passengerDetailsCollected = false;
const persistedMessages = new Set<string>();
const conversations = new Map<string, ConversationRecord>();
const savedConversationId = "11111111-1111-4111-8111-111111111111";
const conversationRepository: ConversationRepository = {
  async findByPhoneNumber(phoneNumber) {
    return conversations.get(phoneNumber);
  },
  async save(conversation) {
    const saved = {
      ...conversation,
      id: savedConversationId,
      userId: "22222222-2222-4222-8222-222222222222",
      draft: { ...conversation.draft },
    };
    conversations.set(conversation.phoneNumber, saved);
    return saved;
  },
};

const app = buildServer({
  whatsappVerifyToken: "verify-token",
  whatsappAppSecret: "",
  conversationRepository,
  messageRepository: {
    async recordInboundMessage(input) {
      assert.equal(input.conversationId, savedConversationId);
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
  intentExtractor: {
    async extractTripIntent() {
      return {
        destination: "Abuja",
        departureDate: "2026-04-30",
        departureWindow: "morning",
      };
    },
  },
  flightSearchHandler: {
    async searchAndPresent(input) {
      assert.equal(input.conversationId, savedConversationId);
      assert.equal(input.userId, "22222222-2222-4222-8222-222222222222");
      return {
        type: "flight_list",
        body: "I found these flights.",
        buttonText: "Choose flight",
        rows: [{ id: "flight_option:33333333-3333-4333-8333-333333333333", title: "Ibom Air", description: "08:45 - NGN 158,000" }],
      };
    },
  },
  bookingHandler: {
    async createFromFlightSelection(input) {
      assert.equal(input.userId, "22222222-2222-4222-8222-222222222222");
      assert.equal(input.conversationId, savedConversationId);
      assert.equal(input.selectedFlightOptionId, "33333333-3333-4333-8333-333333333333");
      return {
        type: "text",
        body: "Booking created. Please send passenger details.",
      };
    },
    async collectPassengerDetails(input) {
      if (input.text !== "Celestine Ejiofor, male, 08012345678, celestine@email.com, 1990-04-12" && input.passenger?.email !== "celestine@email.com") return undefined;
      assert.equal(input.userId, "22222222-2222-4222-8222-222222222222");
      assert.equal(input.conversationId, savedConversationId);
      passengerDetailsCollected = true;
      return {
        type: "text",
        body: "Wakanow hold created. Continue to payment.",
      };
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

const signedApp = buildServer({
  whatsappVerifyToken: "verify-token",
  whatsappAppSecret: "test-app-secret",
  conversationRepository,
  whatsappClient: {
    async sendMessage() {},
  },
  intentExtractor: {
    async extractTripIntent() {
      return {};
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

const unsignedStatus = await signedApp.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  payload: { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.status" }] } }] }] },
});
assert.equal(unsignedStatus.statusCode, 401);
assert.deepEqual(JSON.parse(unsignedStatus.body), {
  error: "invalid_signature",
  reason: "missing_signature",
});

const signedStatusPayload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.status" }] } }] }] });
const signedStatus = await signedApp.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": metaSignature("test-app-secret", signedStatusPayload),
  },
  payload: signedStatusPayload,
});
assert.equal(signedStatus.statusCode, 200);
assert.deepEqual(JSON.parse(signedStatus.body), { ok: true, received: 0 });

const prettySignedStatusPayload = JSON.stringify(
  { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.pretty-status" }] } }] }] },
  null,
  2
);
const prettySignedStatus = await signedApp.inject({
  method: "POST",
  url: "/webhooks/whatsapp",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": metaSignature("test-app-secret", prettySignedStatusPayload),
  },
  payload: prettySignedStatusPayload,
});
assert.equal(prettySignedStatus.statusCode, 200);
assert.deepEqual(JSON.parse(prettySignedStatus.body), { ok: true, received: 0 });
await signedApp.close();

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

for (const [id, replyId] of [
  ["wamid.2", "origin:LOS"],
  ["wamid.3", "trip_type:one_way"],
  ["wamid.4", "passengers:1"],
] as const) {
  const response = await app.inject({
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
                    id,
                    from: "2348012345678",
                    timestamp: "1777449600",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: { id: replyId, title: replyId },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  assert.equal(response.statusCode, 200);
}

await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(sentMessages.length, 4);
assert.equal((sentMessages[3] as { message: { type: string } }).message.type, "interactive");

const selected = await app.inject({
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
                  id: "wamid.5",
                  from: "2348012345678",
                  timestamp: "1777449600",
                  type: "interactive",
                  interactive: {
                    type: "list_reply",
                    list_reply: {
                      id: "flight_option:33333333-3333-4333-8333-333333333333",
                      title: "Ibom Air",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
});
assert.equal(selected.statusCode, 200);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(sentMessages.length, 5);

const passengerFlowDetails = await app.inject({
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
                  id: "wamid.7",
                  from: "2348012345678",
                  timestamp: "1777449600",
                  type: "interactive",
                  interactive: {
                    type: "nfm_reply",
                    nfm_reply: {
                      response_json: JSON.stringify({
                        title: "Mr",
                        firstName: "Celestine",
                        lastName: "Ejiofor",
                        dateOfBirth: "1990-04-12",
                        gender: "Male",
                        phone: "08012345678",
                        email: "celestine@email.com",
                      }),
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
});
assert.equal(passengerFlowDetails.statusCode, 200);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(passengerDetailsCollected, true);
await app.close();
console.log("whatsapp route tests passed");

function metaSignature(appSecret: string, payload: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(payload).digest("hex")}`;
}
