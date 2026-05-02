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
import { bookingConfirmReplyId, flightOptionReplyId, passengerReplyIds } from "../../src/channels/whatsapp/whatsapp.reply-ids";
import { whatsappOriginRows } from "../../src/domain/flight/airport-catalog";
import { describe, expect, test } from "vitest";


describe("integration whatsapp tool routes", () => {
  test("whatsapp tool routes", async () => {
    type FlightSearchHandlerInput = Parameters<FlightSearchHandler["searchAndPresent"]>[0];
    type BookingSelectionInput = Parameters<BookingSelectionHandler["createFromFlightSelection"]>[0];
    type PassengerDetailsInput = Parameters<BookingSelectionHandler["collectPassengerDetails"]>[0];

    type SentMessage = {
      to: string;
      message: Record<string, unknown>;
    };
    type ReadEvent = { messageId: string };
    type TypingEvent = { messageId: string };

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
    await marksInboundMessagesReadAndShowsTyping();
    await ignoresReadAndTypingIndicatorFailures();
    await dedupesProviderMessages();
    await asksOnlyTheWorkflowPromptForFirstTimeTripRequests();
    await usesSavedOnboardingForFirstTimeGreetingOnlyUsers();
    await usesControlledCopyWhenChatModelSelectsIt();
    await sendsSafeCustomClarificationWidgets();
    await blocksUnsafeCustomClarificationWidgets();
    await letsModelAnswerReturningGreetingWithoutTripPrompt();
    await resumesPendingPromptAfterSideQuestionAnswer();
    await includesConversationContextForFollowUpAnswers();
    await dedupesRepeatedRecentMessagesBeforeChatModel();
    await repliesWhenChatModelFails();
    await usesControlledPromptWhenModelRequestsTripCollection();
    await asksControlledNextQuestionAfterTripDetailExtraction();
    await searchesWhenExtractedTripDetailsCompleteTheDraft();
    await executesSearchTool();
    await resetsStaleTripDraftForFreshFlightRequest();
    await rejectsStaleSearchFieldsForFreshFlightRequest();
    await asksForFlightConfirmationBeforeBooking();
    await startsBookingAfterFlightConfirmation();
    await continuesBookingWithSavedPassenger();
    await opensPassengerFlowForDifferentPassenger();
    await fallsBackToTextWhenPassengerFlowSendFails();
    await collectsPassengerDetailsFromFallbackText();
    await repliesWhenPassengerDetailsQueueFails();
    await sendsLegacyInteractiveRepliesThroughTripCollectionTool();
    await appliesOriginReplyWithoutLosingCollectedDate();

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

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: "invalid_signature",
        reason: "signature_mismatch",
      });
      expect(sentMessages.length).toBe(0);

      await app.close();
    }

    async function marksInboundMessagesReadAndShowsTyping(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const readEvents: ReadEvent[] = [];
      const typingEvents: TypingEvent[] = [];
      const app = buildToolRouteServer({
        sentMessages,
        readEvents,
        typingEvents,
        chatModel: async () => ({
          action: "answerSideQuestion",
          message: "I can help with that.",
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: null,
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.read-typing", text: "I want to travel" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(readEvents).toEqual([{ messageId: "wamid.read-typing" }]);
      expect(typingEvents).toEqual([{ messageId: "wamid.read-typing" }]);

      await app.close();
    }

    async function ignoresReadAndTypingIndicatorFailures(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const app = buildToolRouteServer({
        sentMessages,
        whatsappClientOverrides: {
          async markMessageRead() {
            throw new Error("read failed");
          },
          async showTypingIndicator() {
            throw new Error("typing failed");
          },
        },
        chatModel: async () => ({
          action: "answerSideQuestion",
          message: "I can still reply.",
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: null,
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.read-typing-fail", text: "I want to travel" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);
      expect(((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "")).toMatch(/I can still reply\./);

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
          return {
            action: "answerSideQuestion",
            message: "I can help with that.",
            searchFlightsInput: null,
            collectTripDetailsInput: null,
            sendControlledReplyInput: null,
            customClarificationInput: null,
            startBookingJobInput: null,
        passengerDetailsInput: null,
          };
        },
      });

      const first = await signedPost(app, webhookBody({ id: "wamid.duplicate", text: "I want to travel" }));
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body)).toEqual({ ok: true, received: 1 });
      await waitFor(() => sentMessages.length === 1);

      const second = await signedPost(app, webhookBody({ id: "wamid.duplicate", text: "I want to travel" }));
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toEqual({ ok: true, received: 0 });
      await sleep(20);

      expect(sentMessages.length).toBe(1);
      expect(chatModelCalls).toBe(1);

      await app.close();
    }

    async function asksOnlyTheWorkflowPromptForFirstTimeTripRequests(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const app = buildToolRouteServer({
        sentMessages,
        messageRepository: createMemoryMessageRepository(),
        chatModel: async () => ({
          type: "tool",
          tool: "collectTripDetails",
          input: {
            destination: "ABV",
            departureDate: "2026-05-02",
            departureWindow: "morning",
          },
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.first-time", text: "I need a flight to Abuja tomorrow morning" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const body = ((sentMessages[0]?.message as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? "");
      expect(body).toBe("Where are you flying from?");

      await app.close();
    }

    async function usesSavedOnboardingForFirstTimeGreetingOnlyUsers(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const typingEvents: TypingEvent[] = [];
      let chatModelCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        typingEvents,
        messageRepository: createMemoryMessageRepository(),
        chatModel: async () => {
          chatModelCalls += 1;
          throw new Error("first-time greeting should not call chat model");
        },
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.first-time-hi", text: "hi" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
      expect(body).toMatch(/^Hi, I’m Skypadi/);
      expect(body).toMatch(/best-value flight/i);
      expect(body).not.toMatch(/cheapest/i);
      expect(body).not.toMatch(/Where are you flying from, where to/);
      expect(chatModelCalls).toBe(0);
      expect(typingEvents).toEqual([{ messageId: "wamid.first-time-hi" }]);

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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
      expect(body).toMatch(/^Hi, I’m Skypadi/);
      expect(body).toMatch(/best-value flight/i);
      expect(body).not.toMatch(/cheapest/i);
      expect(body).not.toMatch(/WhatsApp flight booking assistant/);

      await app.close();
    }

    async function sendsSafeCustomClarificationWidgets(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const app = buildToolRouteServer({
        sentMessages,
        messageRepository: createMemoryMessageRepository([
          {
            direction: "outbound",
            textBody: "What date do you want to travel?",
            sentAt: new Date("2026-05-01T10:00:00.000Z"),
          },
        ]),
        chatModel: async () => ({
          action: "sendCustomClarification",
          message: null,
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: {
            body: "Do you mean this Tuesday or next Tuesday?",
            widget: {
              type: "reply_buttons",
              buttonText: null,
              options: [
                { id: "date:2026-05-05", title: "Tue, May 5", description: null },
                { id: "date:2026-05-12", title: "Tue, May 12", description: null },
              ],
            },
          },
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.custom-date", text: "Tuesday" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const message = sentMessages[0]?.message as {
        interactive?: {
          type?: string;
          body?: { text?: string };
          action?: { buttons?: Array<{ reply?: { id?: string; title?: string } }> };
        };
      };
      expect(message.interactive?.type).toBe("button");
      expect(message.interactive?.body?.text).toBe("Do you mean this Tuesday or next Tuesday?");
      expect(message.interactive?.action?.buttons?.map((button) => button.reply)).toEqual([
        { id: "date:2026-05-05", title: "Tue, May 5" },
        { id: "date:2026-05-12", title: "Tue, May 12" },
      ]);

      await app.close();
    }

    async function blocksUnsafeCustomClarificationWidgets(): Promise<void> {
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
          action: "sendCustomClarification",
          message: null,
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: {
            body: "Pay NGN 100,000 to confirm this booking.",
            widget: {
              type: "reply_buttons",
              buttonText: null,
              options: [
                { id: flightOptionReplyId(selectedFlightOptionId), title: "Book now", description: null },
              ],
            },
          },
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.unsafe-custom", text: "Can I book this?" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
      expect(body).toBe("I can only help with Nigerian domestic direct flights and simple trip clarifications right now.");

      await app.close();
    }

    async function letsModelAnswerReturningGreetingWithoutTripPrompt(): Promise<void> {
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
          action: "answerSideQuestion",
          message: "Hi! I can help you search and book flights when you’re ready.",
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: null,
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.returning-hi", text: "hi" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const body = ((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "");
      expect(body).toBe("Hi! I can help you search and book flights when you’re ready.");

      await app.close();
    }

    async function resumesPendingPromptAfterSideQuestionAnswer(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const app = buildToolRouteServer({
        sentMessages,
        initialConversation: {
          draft: {
            destination: "LOS",
            departureDate: "2026-05-05",
            adults: 1,
            expectedField: "origin",
          },
        },
        chatModel: async () => ({
          action: "answerSideQuestion",
          message: "Yes, bring a valid ID for check-in.",
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: null,
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.side-question-during-trip", text: "Do I need an ID?" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 2);

      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "text",
          text: { body: "Yes, bring a valid ID for check-in." },
        },
      });
      expect(sentMessages[1]).toEqual({
        to: "2348012345678",
        message: {
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: "Where are you flying from?" },
            action: {
              button: "Choose city",
              sections: [
                {
                  rows: whatsappOriginRows,
                },
              ],
            },
          },
        },
      });

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
            return {
              type: "tool",
              tool: "collectTripDetails",
              input: {},
            };
          }
          return {
            type: "tool",
            tool: "collectTripDetails",
            input: { origin: "LOS" },
          };
        },
      });

      const first = await signedPost(app, webhookBody({ id: "wamid.context.1", text: "I want to travel" }));
      expect(first.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      const second = await signedPost(app, webhookBody({ id: "wamid.context.2", text: "Lagos" }));
      expect(second.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 2);

      expect(chatModelCalls).toBe(2);
      expect(chatInput?.userText).toBe("Lagos");
      expect(chatInput?.context.currentDraft).toEqual({
        destination: "DXB",
        departureDate: "2026-06-10",
        adults: 1,
        expectedField: "origin",
      });
      expect(chatInput?.context.expectedField).toBe("origin");
      expect(chatInput?.context.recentMessages?.some(
          (message) => message.direction === "outbound" && Boolean(message.textBody?.includes("Where are you flying from?"))
        )).toBe(true);
      expect(chatInput?.context.recentMessages?.at(-1)?.textBody).toBe("Lagos");

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
          return {
            action: "answerSideQuestion",
            message: "Still checking that for you.",
            searchFlightsInput: null,
            collectTripDetailsInput: null,
            sendControlledReplyInput: null,
            customClarificationInput: null,
            startBookingJobInput: null,
        passengerDetailsInput: null,
          };
        },
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.dedupe-context", text: "Morning" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatInput?.context.recentMessages?.map((message) => message.textBody)).toEqual([
          "  I want to book a flight to Lagos next week Tuesday. I’m coming from enugu  ",
          "Sure. Morning or afternoon?",
          "Morning",
        ]);

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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(sentMessages[0]).toEqual({
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
      expect(outbound?.textBody?.includes("I’m having trouble responding right now.")).toBe(true);

      await app.close();
    }

    async function usesControlledPromptWhenModelRequestsTripCollection(): Promise<void> {
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
          tool: "collectTripDetails",
          input: {},
        }),
      });

      const response = await signedPost(app, webhookBody({ id: "wamid.model-trip-collection", text: "Hi" }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: "Where are you flying from?" },
            action: {
              button: "Choose city",
              sections: [
                {
                  rows: whatsappOriginRows,
                },
              ],
            },
          },
        },
      });

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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatInput?.userText).toBe("I want to travel to Lagos next Tuesday");
      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: "Where are you flying from?" },
            action: {
              button: "Choose city",
              sections: [
                {
                  rows: whatsappOriginRows,
                },
              ],
            },
          },
        },
      });

      await app.close();
    }

    async function searchesWhenExtractedTripDetailsCompleteTheDraft(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const typingEvents: TypingEvent[] = [];
      let searchCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        typingEvents,
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
            expect(input.search).toEqual({
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(searchCalls).toBe(1);
      expect(sentMessages[0]?.message.type).toBe("interactive");
      expect(typingEvents).toEqual([
        { messageId: "wamid.complete-trip" },
        { messageId: "wamid.complete-trip" },
      ]);

      await app.close();
    }

    async function executesSearchTool(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const typingEvents: TypingEvent[] = [];
      const messageRepository = createMemoryMessageRepository();
      let searchCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        typingEvents,
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
            expect(input.userId).toBe(savedUserId);
            expect(input.conversationId).toBe(savedConversationId);
            expect(input.phoneNumber).toBe("2348012345678");
            expect(input.search).toEqual({
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(searchCalls).toBe(1);
      expect(sentMessages[0]?.message.type).toBe("interactive");
      expect(typingEvents).toEqual([
        { messageId: "wamid.search" },
        { messageId: "wamid.search" },
      ]);
      const recentMessages = await messageRepository.listRecentMessages({
        conversationId: savedConversationId,
        limit: 8,
      });
      const outbound = recentMessages.find((message) => message.direction === "outbound");
      expect(outbound?.textBody?.includes("I found these flights.")).toBe(true);
      expect(outbound?.payload?.type).toBe("interactive");

      await app.close();
    }

    async function resetsStaleTripDraftForFreshFlightRequest(): Promise<void> {
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
        initialConversation: {
          draft: {
            origin: "ENU",
            destination: "ABV",
            departureDate: "2026-05-06",
            departureWindow: "morning",
            adults: 2,
            expectedField: "origin",
          },
        },
        chatModel: async (input) => {
          chatInput = input;
          return {
            type: "tool",
            tool: "startNewTrip",
            input: {
              destination: "LOS",
              departureDate: "2026-05-05",
            },
          };
        },
      });

      const response = await signedPost(app, webhookBody({
        id: "wamid.new-flight",
        text: "I want to book a flight to Lagos next Tuesday",
      }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatInput?.context.currentDraft).toEqual({});
      expect(chatInput?.context.expectedField).toBe(undefined);
      expect(chatInput?.context.recentMessages).toBe(undefined);
      const body = ((sentMessages[0]?.message as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? "");
      expect(body.endsWith("Where are you flying from?")).toBe(true);

      await app.close();
    }

    async function rejectsStaleSearchFieldsForFreshFlightRequest(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      let searchCalls = 0;
      let chatInput: DecideChatActionInput | undefined;
      const app = buildToolRouteServer({
        sentMessages,
        messageRepository: createMemoryMessageRepository([
          {
            direction: "outbound",
            textBody: "I’m having trouble responding right now. I still have your ENU to LOS morning trip for 2026-05-07.",
            sentAt: new Date("2026-05-02T01:53:00.000Z"),
          },
        ]),
        initialConversation: {
          draft: {
            origin: "ENU",
            destination: "LOS",
            departureDate: "2026-05-07",
            departureWindow: "morning",
            adults: 1,
          },
        },
        chatModel: async (input) => {
          chatInput = input;
          return {
            type: "tool",
            tool: "searchFlights",
            input: {
              origin: "ENU",
              destination: "LOS",
              departureDate: "2026-05-07",
              departureWindow: "morning",
              adults: 1,
            },
          };
        },
        flightSearchHandler: {
          async searchAndPresent() {
            searchCalls += 1;
            return { type: "text", body: "This should not search." };
          },
        },
      });

      const response = await signedPost(app, webhookBody({
        id: "wamid.new-flight-stale-search",
        text: "I want to book a flight to Lagos next week Thursday early morning",
      }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatInput?.context.currentDraft).toEqual({});
      expect(chatInput?.context.expectedField).toBe(undefined);
      expect(chatInput?.context.recentMessages).toBe(undefined);
      expect(searchCalls).toBe(0);
      const body = ((sentMessages[0]?.message as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? "");
      expect(body.endsWith("Where are you flying from?")).toBe(true);

      await app.close();
    }

    async function asksForFlightConfirmationBeforeBooking(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      let bookingCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        bookingHandler: {
          async previewFlightSelection(input: BookingSelectionInput) {
            expect(input.userId).toBe(savedUserId);
            expect(input.conversationId).toBe(savedConversationId);
            expect(input.phoneNumber).toBe("2348012345678");
            expect(input.selectedFlightOptionId).toBe(selectedFlightOptionId);
            return {
              type: "reply_buttons",
              body: "Great. Here’s your booking summary:\nRoute: Enugu → Lagos\nFlight: United Nigeria, 8:40 AM\nFare: ₦103,765\nContinue booking this flight?",
              buttons: [
                { id: bookingConfirmReplyId(selectedFlightOptionId), title: "Continue booking" },
                { id: "booking_change:flight", title: "Pick another" },
              ],
            };
          },
          async createFromFlightSelection(input: BookingSelectionInput) {
            bookingCalls += 1;
            return { type: "text", body: `unexpected ${input.selectedFlightOptionId}` };
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(bookingCalls).toBe(0);
      expect(sentMessages[0]?.message.type).toBe("interactive");
      expect((sentMessages[0]?.message.interactive as { type?: string } | undefined)?.type).toBe("button");
      expect(((sentMessages[0]?.message.interactive as { body?: { text?: string } } | undefined)?.body?.text ?? "")).toMatch(/Continue booking this flight\?/);

      await app.close();
    }

    async function startsBookingAfterFlightConfirmation(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const messageRepository = createMemoryMessageRepository();
      let bookingCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        messageRepository,
        bookingHandler: {
          async createFromFlightSelection(input: BookingSelectionInput) {
            bookingCalls += 1;
            expect(input.userId).toBe(savedUserId);
            expect(input.conversationId).toBe(savedConversationId);
            expect(input.phoneNumber).toBe("2348012345678");
            expect(input.selectedFlightOptionId).toBe(selectedFlightOptionId);
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
          id: "wamid.booking-confirmation",
          interactive: {
            type: "button_reply",
            button_reply: { id: bookingConfirmReplyId(selectedFlightOptionId), title: "Continue booking" },
          },
        })
      );
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(bookingCalls).toBe(1);
      expect(sentMessages[0]?.message.type).toBe("interactive");
      expect((sentMessages[0]?.message.interactive as { type?: string } | undefined)?.type).toBe("flow");
      const recentMessages = await messageRepository.listRecentMessages({
        conversationId: savedConversationId,
        limit: 8,
      });
      const outbound = recentMessages.find((message) => message.direction === "outbound");
      expect(outbound?.textBody).toBe("Great choice. I need passenger details.");
      expect(outbound?.payload?.type).toBe("interactive");

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
            expect(input.userId).toBe(savedUserId);
            expect(input.conversationId).toBe(savedConversationId);
            expect(input.phoneNumber).toBe("2348012345678");
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(continueCalls).toBe(1);
      expect(sentMessages[0]).toEqual({
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
            expect(input.userId).toBe(savedUserId);
            expect(input.conversationId).toBe(savedConversationId);
            expect(input.phoneNumber).toBe("2348012345678");
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(passengerDetailRequests).toBe(1);
      expect(sentMessages[0]?.message.type).toBe("interactive");
      expect((sentMessages[0]?.message.interactive as { type?: string } | undefined)?.type).toBe("flow");

      await app.close();
    }

    async function fallsBackToTextWhenPassengerFlowSendFails(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      let flowSendAttempts = 0;
      const app = buildToolRouteServer({
        sentMessages,
        whatsappClientOverrides: {
          async sendMessage(input) {
            if ((input.message.interactive as { type?: string } | undefined)?.type === "flow") {
              flowSendAttempts += 1;
              throw new Error("flow rejected");
            }
            sentMessages.push(input as SentMessage);
          },
        },
        bookingHandler: {
          async createFromFlightSelection() {
            return { type: "text", body: "unused" };
          },
          async requestPassengerDetails() {
            return {
              type: "passenger_details_flow",
              body: "Enter passenger details.",
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
          id: "wamid.flow-fallback",
          interactive: {
            type: "button_reply",
            button_reply: { id: passengerReplyIds.different, title: "Different passenger" },
          },
        })
      );
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(flowSendAttempts).toBe(1);
      expect(sentMessages[0]?.message.type).toBe("text");
      expect(((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "")).toMatch(/full name/i);
      expect(((sentMessages[0]?.message as { text?: { body?: string } }).text?.body ?? "")).toMatch(/date of birth/i);

      await app.close();
    }

    async function collectsPassengerDetailsFromFallbackText(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      let collectedPassengerEmail: string | undefined;
      const app = buildToolRouteServer({
        sentMessages,
        initialConversation: {
          draft: { expectedField: "passenger_details" },
        },
        chatModel: async () => ({
          type: "tool",
          tool: "collectPassengerDetails",
          input: {
            title: "Mr",
            firstName: "Celestine",
            lastName: "Ejiofor",
            dateOfBirth: "1990-04-12",
            gender: "Male",
            phone: "08012345678",
            email: "celestine@example.com",
          },
        }),
        bookingHandler: {
          async createFromFlightSelection() {
            return { type: "text", body: "unused" };
          },
          async collectPassengerDetails(input: PassengerDetailsInput) {
            collectedPassengerEmail = input.passenger?.email;
            return { type: "text", body: "Booking started. I’ll update you shortly." };
          },
        },
      });

      const response = await signedPost(app, webhookBody({
        id: "wamid.passenger-text",
        text: "Celestine Ejiofor, male, 12 April 1990, 08012345678, celestine@example.com",
      }));
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(collectedPassengerEmail).toBe("celestine@example.com");
      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "text",
          text: { body: "Booking started. I’ll update you shortly." },
        },
      });

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
            expect(input.userId).toBe(savedUserId);
            expect(input.passenger?.email).toBe("celestine@example.com");
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "text",
          text: { body: "I could not start the supplier booking yet. Please try again shortly." },
        },
      });

      await app.close();
    }

    async function sendsLegacyInteractiveRepliesThroughTripCollectionTool(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      let chatModelCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        initialConversation: {
          draft: { expectedField: "origin" },
        },
        chatModel: async () => {
          chatModelCalls += 1;
          return {
            type: "tool",
            tool: "collectTripDetails",
            input: { origin: "LOS" },
          };
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
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatModelCalls).toBe(0);
      expect(sentMessages[0]).toEqual({
        to: "2348012345678",
        message: {
          type: "text",
          text: { body: "Where are you flying to?" },
        },
      });

      await app.close();
    }

    async function appliesOriginReplyWithoutLosingCollectedDate(): Promise<void> {
      const sentMessages: SentMessage[] = [];
      const typingEvents: TypingEvent[] = [];
      let chatModelCalls = 0;
      let searchCalls = 0;
      const app = buildToolRouteServer({
        sentMessages,
        typingEvents,
        initialConversation: {
          draft: {
            destination: "LOS",
            departureDate: "2026-05-07",
            departureWindow: "morning",
            adults: 1,
            expectedField: "origin",
          },
        },
        chatModel: async () => {
          chatModelCalls += 1;
          return {
            type: "tool",
            tool: "collectTripDetails",
            input: { origin: "ENU" },
          };
        },
        flightSearchHandler: {
          async searchAndPresent(input: FlightSearchHandlerInput) {
            searchCalls += 1;
            expect(input.search).toEqual({
              origin: "ENU",
              destination: "LOS",
              departureDate: "2026-05-07",
              departureWindow: "morning",
              tripType: "one_way",
              returnDate: undefined,
              adults: 1,
            });
            return {
              type: "flight_list",
              body: "I found the best morning option.",
              buttonText: "Book this",
              rows: [
                {
                  id: flightOptionReplyId(selectedFlightOptionId),
                  title: "United Nigeria",
                  description: "08:40 - NGN 103,765",
                },
              ],
            };
          },
        },
      });

      const response = await signedPost(
        app,
        interactiveWebhookBody({
          id: "wamid.origin-reply-preserves-date",
          interactive: {
            type: "button_reply",
            button_reply: { id: "origin:ENU", title: "Enugu" },
          },
        })
      );
      expect(response.statusCode).toBe(200);
      await waitFor(() => sentMessages.length === 1);

      expect(chatModelCalls).toBe(0);
      expect(searchCalls).toBe(1);
      expect(typingEvents).toEqual([
        { messageId: "wamid.origin-reply-preserves-date" },
        { messageId: "wamid.origin-reply-preserves-date" },
      ]);
      expect(sentMessages[0]?.message.type).toBe("interactive");

      await app.close();
    }

    function buildToolRouteServer(input: {
      sentMessages: SentMessage[];
      readEvents?: ReadEvent[];
      typingEvents?: TypingEvent[];
      whatsappClientOverrides?: {
        sendMessage?: (input: { to: string; message: Record<string, unknown> }) => Promise<void>;
        markMessageRead?: (input: { messageId: string }) => Promise<void>;
        showTypingIndicator?: (input: { messageId: string }) => Promise<void>;
      };
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
            if (input.whatsappClientOverrides?.sendMessage) {
              return input.whatsappClientOverrides.sendMessage(message as SentMessage);
            }
            input.sentMessages.push(message as SentMessage);
          },
          async markMessageRead(message) {
            if (input.whatsappClientOverrides?.markMessageRead) {
              return input.whatsappClientOverrides.markMessageRead(message);
            }
            input.readEvents?.push(message);
          },
          async showTypingIndicator(message) {
            if (input.whatsappClientOverrides?.showTypingIndicator) {
              return input.whatsappClientOverrides.showTypingIndicator(message);
            }
            input.typingEvents?.push(message);
          },
        },
        chatModel:
          input.chatModel ??
          (async () => ({
            action: "answerSideQuestion",
            message: "I can help with that.",
            searchFlightsInput: null,
            collectTripDetailsInput: null,
            sendControlledReplyInput: null,
            customClarificationInput: null,
            startBookingJobInput: null,
        passengerDetailsInput: null,
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
          const existing = conversations.has(conversation.phoneNumber);
          const saved = {
            ...conversation,
            id: savedConversationId,
            userId: savedUserId,
            draft: existing ? { ...conversation.draft } : { ...input.draft, ...conversation.draft },
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
          expect(input.conversationId).toBe(savedConversationId);
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
          expect(input.conversationId).toBe(savedConversationId);
          messages.push({
            direction: "outbound",
            textBody: input.textBody,
            payload: input.payload,
            sentAt: input.sentAt,
          });
        },
        async listRecentMessages(input: { conversationId: string; limit: number }) {
          expect(input.conversationId).toBe(savedConversationId);
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
  });
});
