import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildServer, type BuildServerOptions } from "../../src/app";
import type { BookingSelectionHandler, FlightSearchHandler } from "../../src/channels/whatsapp/whatsapp.handlers";
import type {
  ConversationRecord,
  ConversationRepository,
  WhatsAppMessageRepository,
} from "../../src/domain/conversation/conversation.types";
import type { ChatModel } from "../../src/tools/chat-agent";
import type { DecideChatActionInput } from "../../src/tools/chat-tool.types";
import { flightOptionReplyId, passengerReplyIds } from "../../src/channels/whatsapp/whatsapp.reply-ids";

type FlightSearchHandlerInput = Parameters<FlightSearchHandler["searchAndPresent"]>[0];
type BookingSelectionInput = Parameters<BookingSelectionHandler["createFromFlightSelection"]>[0];
type PassengerDetailsInput = Parameters<BookingSelectionHandler["collectPassengerDetails"]>[0];

type SentMessage = {
  to: string;
  message: Record<string, unknown>;
};

type RecentMessage = {
  direction: "inbound" | "outbound" | "system";
  textBody?: string;
  payload?: Record<string, unknown>;
  receivedAt?: Date;
  sentAt?: Date;
};

const savedConversationId = "11111111-1111-4111-8111-111111111111";
const savedUserId = "22222222-2222-4222-8222-222222222222";
const selectedFlightOptionId = "33333333-3333-4333-8333-333333333333";

await rejectsInvalidMetaSignature();
await dedupesProviderMessages();
await prependsOnboardingForFirstTimeUsers();
await usesSavedOnboardingForFirstTimeGreetingOnlyUsers();
await usesControlledCopyWhenChatModelSelectsIt();
await letsModelReplyToReturningGreetingUsers();
await includesConversationContextForFollowUpAnswers();
await dedupesRepeatedRecentMessagesBeforeChatModel();
await repliesWhenChatModelFails();
await asksControlledNextQuestionAfterTripDetailExtraction();
await searchesWhenExtractedTripDetailsCompleteTheDraft();
await executesSearchTool();
await startsBookingFromFlightSelection();
await continuesBookingWithSavedPassenger();
await opensPassengerFlowForDifferentPassenger();
await repliesWhenPassengerDetailsQueueFails();
await sendsLegacyInteractiveRepliesToChatModel();

console.log("whatsapp tool route tests passed");

async function rejectsInvalidMetaSignature(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    whatsappAppSecret: "secret",
  });

  const response = await app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    payload: webhookBody({ id: "wamid.bad-signature", text: "I want to travel" }),
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), {
    error: "invalid_signature",
    reason: "signature_mismatch",
  });
  assert.equal(sentMessages.length, 0);

  await app.close();
}

async function dedupesProviderMessages(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let chatModelCalls = 0;
  const messageRepository = createMemoryMessageRepository();
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    chatModel: async () => {
      chatModelCalls += 1;
      return { type: "reply", message: "Sure. Where are you flying from?" };
    },
  });

  const first = await signedPost(app, webhookBody({ id: "wamid.duplicate", text: "I want to travel" }));
  assert.equal(first.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body), { ok: true, received: 1 });
  await waitFor(() => sentMessages.length === 1);

  const second = await signedPost(app, webhookBody({ id: "wamid.duplicate", text: "I want to travel" }));
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), { ok: true, received: 0 });
  await sleep(20);

  assert.equal(sentMessages.length, 1);
  assert.equal(chatModelCalls, 1);

  await app.close();
}

async function prependsOnboardingForFirstTimeUsers(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository: createMemoryMessageRepository(),
    chatModel: async () => ({
      type: "reply",
      message: "Sure. Are you flying from Lagos?",
    }),
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.first-time", text: "I need a flight to Abuja tomorrow morning" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
  assert.match(body, /^Hi, I’m Skypadi/);
  assert.match(body, /Sure\. Are you flying from Lagos\?/);

  await app.close();
}

async function usesSavedOnboardingForFirstTimeGreetingOnlyUsers(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository: createMemoryMessageRepository(),
    chatModel: async () => ({
      type: "reply",
      message: "Hi! Where are you flying from, where to, what date, and how many adults?",
    }),
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.first-time-hi", text: "hi" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
  assert.match(body, /^Hi, I’m Skypadi/);
  assert.doesNotMatch(body, /Where are you flying from, where to/);

  await app.close();
}

async function usesControlledCopyWhenChatModelSelectsIt(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository: createMemoryMessageRepository([
      {
        direction: "outbound",
        textBody: "Hi, I’m Skypadi — your AI travel agent.",
        sentAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]),
    chatModel: async () => ({
      type: "tool",
      tool: "sendControlledReply",
      input: { key: "skypadi_intro" },
    }),
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.about-skypadi", text: "Tell me about skypadi" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
  assert.match(body, /^Hi, I’m Skypadi/);
  assert.doesNotMatch(body, /WhatsApp flight booking assistant/);

  await app.close();
}

async function letsModelReplyToReturningGreetingUsers(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository: createMemoryMessageRepository([
      {
        direction: "outbound",
        textBody: "Hi, I’m Skypadi — your AI travel agent.",
        sentAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]),
    chatModel: async () => ({
      type: "reply",
      message: "Hi! Where are you flying from, where to, what date, and how many adults?",
    }),
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.returning-hi", text: "hi" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
  assert.equal(body, "Hi! Where are you flying from, where to, what date, and how many adults?");

  await app.close();
}

async function includesConversationContextForFollowUpAnswers(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let chatInput: DecideChatActionInput | undefined;
  const messageRepository = createMemoryMessageRepository();
  let chatModelCalls = 0;
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    initialConversation: {
      draft: {
        destination: "DXB",
        departureDate: "2026-06-10",
        adults: 1,
        expectedField: "origin",
      },
    },
    chatModel: async (input) => {
      chatModelCalls += 1;
      chatInput = input;
      if (chatModelCalls === 1) {
        return { type: "reply", message: "Where are you flying from?" };
      }
      return { type: "reply", message: "Got Lagos. What time works best?" };
    },
  });

  const first = await signedPost(app, webhookBody({ id: "wamid.context.1", text: "I want to travel" }));
  assert.equal(first.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  const second = await signedPost(app, webhookBody({ id: "wamid.context.2", text: "Lagos" }));
  assert.equal(second.statusCode, 200);
  await waitFor(() => sentMessages.length === 2);

  assert.equal(chatModelCalls, 2);
  assert.equal(chatInput?.userText, "Lagos");
  assert.deepEqual(chatInput?.context.currentDraft, {
    destination: "DXB",
    departureDate: "2026-06-10",
    adults: 1,
    expectedField: "origin",
  });
  assert.equal(chatInput?.context.expectedField, "origin");
  assert.equal(
    chatInput?.context.recentMessages?.some(
      (message) => message.direction === "outbound" && Boolean(message.textBody?.includes("Where are you flying from?"))
    ),
    true
  );
  assert.equal(chatInput?.context.recentMessages?.at(-1)?.textBody, "Lagos");

  await app.close();
}

async function dedupesRepeatedRecentMessagesBeforeChatModel(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let chatInput: DecideChatActionInput | undefined;
  const messageRepository = createMemoryMessageRepository([
    {
      direction: "inbound",
      textBody: "I want to book a flight to Lagos next week Tuesday. I’m coming from enugu",
      receivedAt: new Date("2026-04-29T14:48:34.000Z"),
    },
    {
      direction: "inbound",
      textBody: "I want to book a flight to Lagos next week Tuesday. I’m coming from enugu",
      receivedAt: new Date("2026-04-29T14:49:14.000Z"),
    },
    {
      direction: "inbound",
      textBody: "  I want to book a flight to Lagos next week Tuesday. I’m coming from enugu  ",
      receivedAt: new Date("2026-04-29T14:54:40.000Z"),
    },
    {
      direction: "outbound",
      textBody: "Sure. Morning or afternoon?",
      sentAt: new Date("2026-04-29T14:55:00.000Z"),
    },
  ]);
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    chatModel: async (input) => {
      chatInput = input;
      return { type: "reply", message: "Still checking that for you." };
    },
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.dedupe-context", text: "Morning" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.deepEqual(
    chatInput?.context.recentMessages?.map((message) => message.textBody),
    [
      "  I want to book a flight to Lagos next week Tuesday. I’m coming from enugu  ",
      "Sure. Morning or afternoon?",
      "Morning",
    ]
  );

  await app.close();
}

async function repliesWhenChatModelFails(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const messageRepository = createMemoryMessageRepository();
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    initialConversation: {
      draft: {
        adults: 1,
        origin: "ENU",
        destination: "LOS",
        departureDate: "2026-05-05",
        departureWindow: "morning",
        tripType: "one_way",
      },
    },
    chatModel: async () => {
      throw new Error("insufficient_quota");
    },
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.model-failure", text: "Heyyy" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.deepEqual(sentMessages[0], {
    to: "2348012345678",
    message: {
      type: "text",
      text: {
        body: "I’m having trouble responding right now. I still have your ENU to LOS morning trip for 2026-05-05. Please message me again shortly.",
      },
    },
  });

  const recentMessages = await messageRepository.listRecentMessages({
    conversationId: savedConversationId,
    limit: 8,
  });
  const outbound = recentMessages.find((message) => message.direction === "outbound");
  assert.equal(outbound?.textBody?.includes("I’m having trouble responding right now."), true);

  await app.close();
}

async function asksControlledNextQuestionAfterTripDetailExtraction(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let chatInput: DecideChatActionInput | undefined;
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository: createMemoryMessageRepository([
      {
        direction: "outbound",
        textBody: "Hi, I’m Skypadi — your AI travel agent.",
        sentAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]),
    chatModel: async (input) => {
      chatInput = input;
      return {
        type: "tool",
        tool: "collectTripDetails",
        input: {
          destination: "LOS",
          departureDate: "2026-05-05",
        },
      };
    },
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.partial-trip", text: "I want to travel to Lagos next Tuesday" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(chatInput?.userText, "I want to travel to Lagos next Tuesday");
  assert.deepEqual(sentMessages[0], {
    to: "2348012345678",
    message: {
      type: "text",
      text: { body: "Where are you flying from?" },
    },
  });

  await app.close();
}

async function searchesWhenExtractedTripDetailsCompleteTheDraft(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let searchCalls = 0;
  const app = buildToolRouteServer({
    sentMessages,
    initialConversation: {
      draft: {
        destination: "LOS",
        departureDate: "2026-05-05",
      },
    },
    chatModel: async () => ({
      type: "tool",
      tool: "collectTripDetails",
      input: {
        origin: "ENU",
        departureWindow: "morning",
        adults: 1,
      },
    }),
    flightSearchHandler: {
      async searchAndPresent(input: FlightSearchHandlerInput) {
        searchCalls += 1;
        assert.deepEqual(input.search, {
          origin: "ENU",
          destination: "LOS",
          departureDate: "2026-05-05",
          departureWindow: "morning",
          tripType: "one_way",
          returnDate: undefined,
          adults: 1,
        });
        return {
          type: "flight_list",
          body: "I found the best morning option.",
          buttonText: "Choose flight",
          rows: [
            {
              id: flightOptionReplyId(selectedFlightOptionId),
              title: "SkyPadi Air",
              description: "08:45 - NGN 158,000",
            },
          ],
        };
      },
    },
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.complete-trip", text: "I am coming from Enugu, morning, just me" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(searchCalls, 1);
  assert.equal(sentMessages[0]?.message.type, "interactive");

  await app.close();
}

async function executesSearchTool(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const messageRepository = createMemoryMessageRepository();
  let searchCalls = 0;
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    chatModel: async () => ({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "LOS",
        destination: "DXB",
        departureDate: "2026-06-10",
        returnDate: "2026-06-17",
        adults: 2,
      },
    }),
    flightSearchHandler: {
      async searchAndPresent(input: FlightSearchHandlerInput) {
        searchCalls += 1;
        assert.equal(input.userId, savedUserId);
        assert.equal(input.conversationId, savedConversationId);
        assert.equal(input.phoneNumber, "2348012345678");
        assert.deepEqual(input.search, {
          origin: "LOS",
          destination: "DXB",
          departureDate: "2026-06-10",
          departureWindow: "anytime",
          tripType: "return",
          returnDate: "2026-06-17",
          adults: 2,
        });
        return {
          type: "flight_list",
          body: "I found these flights.",
          buttonText: "Choose flight",
          rows: [
            {
              id: flightOptionReplyId(selectedFlightOptionId),
              title: "SkyPadi Air",
              description: "08:45 - NGN 158,000",
            },
          ],
        };
      },
    },
  });

  const response = await signedPost(app, webhookBody({ id: "wamid.search", text: "Search Lagos to Dubai" }));
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(searchCalls, 1);
  assert.equal(sentMessages[0]?.message.type, "interactive");
  const recentMessages = await messageRepository.listRecentMessages({
    conversationId: savedConversationId,
    limit: 8,
  });
  const outbound = recentMessages.find((message) => message.direction === "outbound");
  assert.equal(outbound?.textBody?.includes("I found these flights."), true);
  assert.equal(outbound?.payload?.type, "interactive");

  await app.close();
}

async function startsBookingFromFlightSelection(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const messageRepository = createMemoryMessageRepository();
  let bookingCalls = 0;
  const app = buildToolRouteServer({
    sentMessages,
    messageRepository,
    bookingHandler: {
      async createFromFlightSelection(input: BookingSelectionInput) {
        bookingCalls += 1;
        assert.equal(input.userId, savedUserId);
        assert.equal(input.conversationId, savedConversationId);
        assert.equal(input.phoneNumber, "2348012345678");
        assert.equal(input.selectedFlightOptionId, selectedFlightOptionId);
        return {
          type: "passenger_details_flow",
          body: "Great choice. I need passenger details.",
          buttonText: "Enter details",
          flowId: "flow-1",
          flowToken: "booking-1",
          data: { bookingId: "booking-1" },
        };
      },
      async collectPassengerDetails() {
        return undefined;
      },
    },
  });

  const response = await signedPost(
    app,
    interactiveWebhookBody({
      id: "wamid.flight-selection",
      interactive: {
        type: "list_reply",
        list_reply: { id: flightOptionReplyId(selectedFlightOptionId), title: "SkyPadi Air" },
      },
    })
  );
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(bookingCalls, 1);
  assert.equal(sentMessages[0]?.message.type, "interactive");
  assert.equal((sentMessages[0]?.message.interactive as { type?: string } | undefined)?.type, "flow");
  const recentMessages = await messageRepository.listRecentMessages({
    conversationId: savedConversationId,
    limit: 8,
  });
  const outbound = recentMessages.find((message) => message.direction === "outbound");
  assert.equal(outbound?.textBody, "Great choice. I need passenger details.");
  assert.equal(outbound?.payload?.type, "interactive");

  await app.close();
}

async function continuesBookingWithSavedPassenger(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let continueCalls = 0;
  const app = buildToolRouteServer({
    sentMessages,
    bookingHandler: {
      async createFromFlightSelection() {
        return { type: "text", body: "unused" };
      },
      async continueWithDefaultPassenger(input) {
        continueCalls += 1;
        assert.equal(input.userId, savedUserId);
        assert.equal(input.conversationId, savedConversationId);
        assert.equal(input.phoneNumber, "2348012345678");
        return { type: "text", body: "Booking started. I’ll update you shortly." };
      },
      async collectPassengerDetails() {
        return undefined;
      },
    },
  });

  const response = await signedPost(
    app,
    interactiveWebhookBody({
      id: "wamid.saved-passenger",
      interactive: {
        type: "button_reply",
        button_reply: { id: passengerReplyIds.useDefault, title: "Continue as Celestine" },
      },
    })
  );
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(continueCalls, 1);
  assert.deepEqual(sentMessages[0], {
    to: "2348012345678",
    message: {
      type: "text",
      text: { body: "Booking started. I’ll update you shortly." },
    },
  });

  await app.close();
}

async function opensPassengerFlowForDifferentPassenger(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let passengerDetailRequests = 0;
  const app = buildToolRouteServer({
    sentMessages,
    bookingHandler: {
      async createFromFlightSelection() {
        return { type: "text", body: "unused" };
      },
      async requestPassengerDetails(input) {
        passengerDetailRequests += 1;
        assert.equal(input.userId, savedUserId);
        assert.equal(input.conversationId, savedConversationId);
        assert.equal(input.phoneNumber, "2348012345678");
        return {
          type: "passenger_details_flow",
          body: "No problem. Enter the passenger details for this booking.",
          buttonText: "Enter details",
          flowId: "flow-1",
          flowToken: "booking-1",
          data: { bookingId: "booking-1" },
        };
      },
      async collectPassengerDetails() {
        return undefined;
      },
    },
  });

  const response = await signedPost(
    app,
    interactiveWebhookBody({
      id: "wamid.different-passenger",
      interactive: {
        type: "button_reply",
        button_reply: { id: passengerReplyIds.different, title: "Different passenger" },
      },
    })
  );
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(passengerDetailRequests, 1);
  assert.equal(sentMessages[0]?.message.type, "interactive");
  assert.equal((sentMessages[0]?.message.interactive as { type?: string } | undefined)?.type, "flow");

  await app.close();
}

async function repliesWhenPassengerDetailsQueueFails(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  const app = buildToolRouteServer({
    sentMessages,
    bookingHandler: {
      async createFromFlightSelection() {
        return { type: "text", body: "unused" };
      },
      async collectPassengerDetails(input: PassengerDetailsInput) {
        assert.equal(input.userId, savedUserId);
        assert.equal(input.passenger?.email, "celestine@example.com");
        return undefined;
      },
    },
  });

  const response = await signedPost(
    app,
    interactiveWebhookBody({
      id: "wamid.passenger-flow-failure",
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
            email: "celestine@example.com",
          }),
        },
      },
    })
  );
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.deepEqual(sentMessages[0], {
    to: "2348012345678",
    message: {
      type: "text",
      text: { body: "I could not start the supplier booking yet. Please try again shortly." },
    },
  });

  await app.close();
}

async function sendsLegacyInteractiveRepliesToChatModel(): Promise<void> {
  const sentMessages: SentMessage[] = [];
  let chatInput: DecideChatActionInput | undefined;
  const app = buildToolRouteServer({
    sentMessages,
    initialConversation: {
      draft: { expectedField: "origin" },
    },
    chatModel: async (input) => {
      chatInput = input;
      return { type: "reply", message: "Got Lagos. Where are you flying to?" };
    },
  });

  const response = await signedPost(
    app,
    interactiveWebhookBody({
      id: "wamid.origin-reply",
      interactive: {
        type: "button_reply",
        button_reply: { id: "origin:LOS", title: "Lagos" },
      },
    })
  );
  assert.equal(response.statusCode, 200);
  await waitFor(() => sentMessages.length === 1);

  assert.equal(chatInput?.userText, "Origin selected: LOS (Lagos)");
  assert.equal(chatInput?.context.currentDraft?.expectedField, "origin");
  assert.deepEqual(sentMessages[0], {
    to: "2348012345678",
    message: {
      type: "text",
      text: { body: "Got Lagos. Where are you flying to?" },
    },
  });

  await app.close();
}

function buildToolRouteServer(input: {
  sentMessages: SentMessage[];
  whatsappAppSecret?: string;
  conversationRepository?: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository & {
    listRecentMessages?: (input: { conversationId: string; limit: number }) => Promise<RecentMessage[]>;
  };
  initialConversation?: { draft?: ConversationRecord["draft"] };
  chatModel?: ChatModel;
  flightSearchHandler?: BuildServerOptions["flightSearchHandler"];
  bookingHandler?: BuildServerOptions["bookingHandler"];
}) {
  return buildServer({
    whatsappVerifyToken: "verify-token",
    whatsappAppSecret: input.whatsappAppSecret ?? "secret",
    conversationRepository:
      input.conversationRepository ??
      createMemoryConversationRepository({
        draft: input.initialConversation?.draft,
      }),
    messageRepository: input.messageRepository ?? createMemoryMessageRepository(),
    whatsappClient: {
      async sendMessage(message) {
        input.sentMessages.push(message as SentMessage);
      },
    },
    chatModel:
      input.chatModel ??
      (async () => ({
        type: "reply",
        message: "Sure. Where are you flying from?",
      })),
    intentExtractor: {
      async extractTripIntent() {
        return {
          kind: "general_chat",
          reply: "This is the old workflow reply.",
        };
      },
    },
    flightSearchHandler:
      input.flightSearchHandler ??
      ({
        async searchAndPresent() {
          return { type: "text", body: "unused" };
        },
      } satisfies NonNullable<BuildServerOptions["flightSearchHandler"]>),
    bookingHandler:
      input.bookingHandler ??
      ({
        async createFromFlightSelection() {
          return { type: "text", body: "unused" };
        },
        async collectPassengerDetails() {
          return undefined;
        },
      } satisfies NonNullable<BuildServerOptions["bookingHandler"]>),
  });
}

function createMemoryConversationRepository(input: { draft?: ConversationRecord["draft"] } = {}): ConversationRepository {
  const conversations = new Map<string, ConversationRecord>();
  return {
    async findByPhoneNumber(phoneNumber) {
      return conversations.get(phoneNumber);
    },
    async save(conversation) {
      const saved = {
        ...conversation,
        id: savedConversationId,
        userId: savedUserId,
        draft: { ...input.draft, ...conversation.draft },
      };
      conversations.set(conversation.phoneNumber, saved);
      return saved;
    },
  };
}

function createMemoryMessageRepository(initialMessages: RecentMessage[] = []) {
  const providerMessageIds = new Set<string>();
  const messages: RecentMessage[] = [...initialMessages];

  return {
    async recordInboundMessage(input: {
      conversationId: string;
      providerMessageId: string;
      textBody?: string;
      receivedAt: Date;
    }) {
      assert.equal(input.conversationId, savedConversationId);
      if (providerMessageIds.has(input.providerMessageId)) return { wasCreated: false };
      providerMessageIds.add(input.providerMessageId);
      messages.push({
        direction: "inbound",
        textBody: input.textBody,
        receivedAt: input.receivedAt,
      });
      return { wasCreated: true };
    },
    async recordOutboundMessage(input: {
      conversationId: string;
      textBody?: string;
      payload: Record<string, unknown>;
      sentAt: Date;
    }) {
      assert.equal(input.conversationId, savedConversationId);
      messages.push({
        direction: "outbound",
        textBody: input.textBody,
        payload: input.payload,
        sentAt: input.sentAt,
      });
    },
    async listRecentMessages(input: { conversationId: string; limit: number }) {
      assert.equal(input.conversationId, savedConversationId);
      return messages.slice(-input.limit);
    },
  };
}

function webhookBody(input: { id: string; text: string }) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: input.id,
                  from: "2348012345678",
                  timestamp: "1777620000",
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function interactiveWebhookBody(input: {
  id: string;
  interactive: {
    type: "button_reply" | "list_reply" | "nfm_reply";
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string };
    nfm_reply?: { response_json?: string; body?: string };
  };
}) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: input.id,
                  from: "2348012345678",
                  timestamp: "1777620000",
                  type: "interactive",
                  interactive: input.interactive,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function signedPost(app: ReturnType<typeof buildServer>, body: string) {
  return app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    payload: body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": metaSignature("secret", body),
    },
  });
}

function metaSignature(appSecret: string, payload: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(payload).digest("hex")}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 200): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for WhatsApp async processing");
    }
    await sleep(5);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
