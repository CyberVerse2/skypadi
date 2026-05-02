import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { mapUiIntentToWhatsAppMessage } from "./whatsapp.mapper";
import type { WhatsAppClient } from "./whatsapp.client";
import type { UiIntent, WhatsAppMessagePayload } from "./whatsapp.types";
import type { Passenger } from "../../schemas/flight-booking";
import { findOrCreateConversation } from "../../domain/conversation/conversation.service";
import type { ConversationRepository, WhatsAppMessageRepository } from "../../domain/conversation/conversation.types";
import { airportByCode, whatsappOriginRows } from "../../domain/flight/airport-catalog";
import { decideChatActionWithModel, type ChatModel } from "../../tools/chat-agent";
import type {
  ChatAction,
  ChatContext,
  ChatContextMessage,
  CollectTripDetailsToolInput,
  SearchFlightsToolInput,
  SendCustomClarificationToolInput,
} from "../../tools/chat-tool.types";
import { executeSearchFlightsTool } from "../../tools/search-flights.tool";
import type { BookingSelectionHandler, FlightSearchHandler } from "./whatsapp.handlers";
import { addFirstTimeOnboarding, isFirstUserReply, SKYPADI_ONBOARDING_MESSAGE } from "./whatsapp.onboarding";
import { passengerActionFromReplyId, selectedFlightOptionIdFromReplyId } from "./whatsapp.reply-ids";

export type WhatsAppToolRoutesOptions = {
  verifyToken: string;
  conversationRepository: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient: WhatsAppClient;
  appSecret?: string;
  chatModel: ChatModel;
  flightSearchHandler: FlightSearchHandler;
  bookingHandler: BookingSelectionHandler;
};

const searchTypingRefreshMs = 8_000;

type RawBodyRequest = FastifyRequest & { rawBody?: string | Buffer };

type WhatsAppInboundMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  interactive?: {
    type?: "button_reply" | "list_reply" | "nfm_reply";
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string };
    nfm_reply?: { response_json?: string; body?: string };
  };
};

type PersistedInboundMessage = {
  message: WhatsAppInboundMessage;
  now: Date;
  conversation: Awaited<ReturnType<ConversationRepository["save"]>>;
};

export function registerWhatsAppToolRoutes(app: FastifyInstance, options: WhatsAppToolRoutesOptions): void {
  app.get("/webhooks/whatsapp", (request, reply) => verifyWebhook(request, reply, options.verifyToken));
  app.post(
    "/webhooks/whatsapp",
    { config: { rawBody: Boolean(options.appSecret) } },
    (request, reply) => handleWebhook(request as RawBodyRequest, reply, options)
  );
}

async function verifyWebhook(request: FastifyRequest, reply: FastifyReply, verifyToken: string) {
  const query = request.query as Record<string, string | undefined>;

  if (
    query["hub.mode"] === "subscribe" &&
    query["hub.verify_token"] === verifyToken &&
    query["hub.challenge"]
  ) {
    return reply.type("text/plain").send(query["hub.challenge"]);
  }

  return reply.status(403).send({ error: "verification_failed" });
}

async function handleWebhook(request: RawBodyRequest, reply: FastifyReply, options: WhatsAppToolRoutesOptions) {
  if (options.appSecret) {
    const signature = validateMetaSignature(request, options.appSecret);
    if (!signature.ok) {
      request.log.warn(
        {
          reason: signature.reason,
          hasRawBody: signature.hasRawBody,
          hasSignature: signature.hasSignature,
        },
        "WhatsApp webhook signature verification failed"
      );
      return reply.status(401).send({ error: "invalid_signature", reason: signature.reason });
    }
  }

  const messages = extractMessages(request.body);
  const persistedMessages = await persistInboundMessages(messages, options);

  void processMessages(persistedMessages, options, request).catch((error) => {
    request.log.error({ err: error }, "WhatsApp webhook processing failed");
  });

  return reply.send({ ok: true, received: persistedMessages.length });
}

async function persistInboundMessages(
  messages: WhatsAppInboundMessage[],
  options: WhatsAppToolRoutesOptions
): Promise<PersistedInboundMessage[]> {
  const persistedMessages: PersistedInboundMessage[] = [];

  for (const message of messages) {
    const now = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
    const conversation = await findOrCreateConversation(options.conversationRepository, message.from, now);
    const savedConversation = await options.conversationRepository.save({ ...conversation, updatedAt: now });
    const record = await options.messageRepository?.recordInboundMessage({
      phoneNumber: message.from,
      conversationId: savedConversation.id,
      providerMessageId: message.id,
      textBody: chatTextFromMessage(message),
      payload: message as unknown as Record<string, unknown>,
      receivedAt: now,
    });

    if (record && !record.wasCreated) continue;
    persistedMessages.push({ message, now, conversation: savedConversation });
  }

  return persistedMessages;
}

async function processMessages(
  persistedMessages: PersistedInboundMessage[],
  options: WhatsAppToolRoutesOptions,
  request: FastifyRequest
): Promise<void> {
  for (const { message, now, conversation } of persistedMessages) {
    await markMessageRead(message, options, request);
    let activeConversation = conversation;

    const passengerAction = passengerActionFromMessage(message);
    if (passengerAction === "use_default") {
      await showTypingIndicator(message, options, request);
      await sendIntentReply(
        (await options.bookingHandler.continueWithDefaultPassenger?.({
          userId: requiredUserId(conversation),
          conversationId: conversation.id,
          phoneNumber: message.from,
        })) ?? supplierBookingStartFailureIntent(),
        conversation.id,
        message,
        options
      );
      request.log.info({ providerMessageId: message.id, resultKind: "booking_saved_passenger" }, "Processed WhatsApp booking message");
      continue;
    }

    if (passengerAction === "different") {
      await showTypingIndicator(message, options, request);
      await sendIntentReply(
        (await options.bookingHandler.requestPassengerDetails?.({
          userId: requiredUserId(conversation),
          conversationId: conversation.id,
          phoneNumber: message.from,
        })) ?? supplierBookingStartFailureIntent(),
        conversation.id,
        message,
        options
      );
      request.log.info({ providerMessageId: message.id, resultKind: "booking_different_passenger" }, "Processed WhatsApp booking message");
      continue;
    }

    const selectedFlightOptionId = selectedFlightOptionIdFromMessage(message);
    if (selectedFlightOptionId) {
      await showTypingIndicator(message, options, request);
      await sendIntentReply(
        await options.bookingHandler.createFromFlightSelection({
          userId: requiredUserId(conversation),
          conversationId: conversation.id,
          phoneNumber: message.from,
          selectedFlightOptionId,
        }),
        conversation.id,
        message,
        options
      );
      request.log.info({ providerMessageId: message.id, resultKind: "booking_selection" }, "Processed WhatsApp booking message");
      continue;
    }

    if (isPassengerDetailsFlowReply(message)) {
      await showTypingIndicator(message, options, request);
    }
    const bookingIntent = await passengerDetailsIntentFromMessage(message, conversation, options);
    if (bookingIntent) {
      await sendIntentReply(bookingIntent, conversation.id, message, options);
      request.log.info({ providerMessageId: message.id, resultKind: "booking_passenger_details" }, "Processed WhatsApp booking message");
      continue;
    }

    const tripDetailsFromReply = tripDetailsFromInteractiveReply(message);
    if (tripDetailsFromReply) {
      await showTypingIndicator(message, options, request);
      const intent = await handleCollectedTripDetails(tripDetailsFromReply, {
        conversation,
        message,
        options,
        request,
        showTypingIndicator: async () => {
          await showTypingIndicator(message, options, request);
        },
      });
      if (intent) {
        await sendIntentReply(intent, conversation.id, message, options);
      }
      request.log.info({ providerMessageId: message.id, resultKind: "controlled_trip_reply" }, "Processed WhatsApp tool message");
      continue;
    }

    const userText = chatTextFromMessage(message);
    if (!userText) continue;

    const isFreshTripRequest = isFreshFlightBookingRequest(userText);
    if (isFreshTripRequest) {
      activeConversation = await options.conversationRepository.save({
        ...conversation,
        draft: {},
        updatedAt: now,
      });
    }

    const context = await chatContextFromConversation({
      conversation: activeConversation,
      message,
      options,
      includeRecentMessages: !isFreshTripRequest,
    });
    if (isFirstTimeGreetingOnly(userText, context)) {
      await showTypingIndicator(message, options, request);
      await sendIntentReply({ type: "text", body: SKYPADI_ONBOARDING_MESSAGE }, activeConversation.id, message, options);
      request.log.info({ providerMessageId: message.id, resultKind: "controlled_onboarding" }, "Processed WhatsApp tool message");
      continue;
    }

    await showTypingIndicator(message, options, request);
    const action = await decideChatActionWithModel(options.chatModel, {
      userText,
      now,
      context,
    }).catch(async (error) => {
      request.log.warn(
        {
          providerMessageId: message.id,
          errorMessage: error instanceof Error ? error.message : "Chat model decision failed",
        },
        "WhatsApp chat model decision failed; sending fallback reply"
      );
      await sendIntentReply(chatDecisionFailureIntent(context), activeConversation.id, message, options);
      return undefined;
    });
    if (!action) continue;

    const effectiveAction = isFreshTripRequest ? removeUngroundedFreshSearchFields(action, userText) : action;
    const intent = addFirstTimeOnboarding(await uiIntentFromChatAction(effectiveAction, {
      conversation: activeConversation,
      message,
      options,
      request,
      showTypingIndicator: async () => {
        await showTypingIndicator(message, options, request);
      },
    }), context);
    if (!intent) continue;

    await sendIntentReply(intent, activeConversation.id, message, options);
    const resumeIntent = promptToResumeAfterSideAnswer(effectiveAction, activeConversation.draft);
    if (resumeIntent) {
      await sendIntentReply(resumeIntent, activeConversation.id, message, options);
    }
    request.log.info({ providerMessageId: message.id, resultKind: effectiveAction.type }, "Processed WhatsApp tool message");
  }
}

async function markMessageRead(
  message: WhatsAppInboundMessage,
  options: WhatsAppToolRoutesOptions,
  request: FastifyRequest
): Promise<void> {
  try {
    await options.whatsappClient.markMessageRead({
      messageId: message.id,
    });
  } catch (error) {
    request.log.warn(
      {
        err: error,
        providerMessageId: message.id,
      },
      "WhatsApp read receipt failed"
    );
  }
}

async function showTypingIndicator(
  message: WhatsAppInboundMessage,
  options: WhatsAppToolRoutesOptions,
  request: FastifyRequest
): Promise<void> {
  try {
    await options.whatsappClient.showTypingIndicator({
      messageId: message.id,
    });
  } catch (error) {
    request.log.warn(
      {
        err: error,
        providerMessageId: message.id,
      },
      "WhatsApp typing indicator failed"
    );
  }
}

function chatDecisionFailureIntent(context: ChatContext): UiIntent {
  const draft = context.currentDraft;
  if (draft?.origin && draft.destination && draft.departureDate) {
    const window = draft.departureWindow && draft.departureWindow !== "anytime" ? `${draft.departureWindow} ` : "";
    return {
      type: "text",
      body: `I’m having trouble responding right now. I still have your ${draft.origin} to ${draft.destination} ${window}trip for ${draft.departureDate}. Please message me again shortly.`,
    };
  }

  return {
    type: "text",
    body: "I’m having trouble responding right now. Please message me again shortly.",
  };
}

function isFirstTimeGreetingOnly(userText: string, context: ChatContext): boolean {
  if (!isFirstUserReply(context)) return false;
  return /^(hi|hello|hey|heyy|heyyy|good morning|good afternoon|good evening)[!. ]*$/i.test(userText.trim());
}

function isFreshFlightBookingRequest(userText: string): boolean {
  const normalized = userText.trim().toLowerCase();
  if (!normalized) return false;
  if (/\b(this|that|selected|option\s*\d+|continue|go ahead|yes)\b/.test(normalized)) return false;

  return /\b(book|find|search|get|need|want)\b[\s\S]{0,80}\b(?:a|another|new)?\s*flights?\b/.test(normalized);
}

function removeUngroundedFreshSearchFields(action: ChatAction, userText: string): ChatAction {
  if (action.type !== "tool" || action.tool !== "searchFlights") return action;
  if (
    messageMentionsAirport(userText, action.input.origin) &&
    messageMentionsAirport(userText, action.input.destination) &&
    messageMentionsPassengerCount(userText, action.input.adults)
  ) {
    return action;
  }

  return {
    type: "tool",
    tool: "startNewTrip",
    input: {
      ...(messageMentionsAirport(userText, action.input.origin) ? { origin: action.input.origin } : {}),
      ...(messageMentionsAirport(userText, action.input.destination) ? { destination: action.input.destination } : {}),
      departureDate: action.input.departureDate,
      ...(action.input.departureWindow ? { departureWindow: action.input.departureWindow } : {}),
      ...(action.input.returnDate ? { returnDate: action.input.returnDate } : {}),
      ...(messageMentionsPassengerCount(userText, action.input.adults) ? { adults: action.input.adults } : {}),
    },
  };
}

function messageMentionsAirport(userText: string, airportCode: string): boolean {
  const airport = airportByCode(airportCode);
  if (!airport) return false;

  const normalizedText = normalizeForMention(userText);
  return [
    airport.code,
    airport.city,
    airport.airportName,
    airport.description ?? "",
  ].some((value) => containsMention(normalizedText, value));
}

function messageMentionsPassengerCount(userText: string, adults: number): boolean {
  const normalized = normalizeForMention(userText);
  if (adults === 1 && /\b(just me|only me|me alone|solo|one adult|1 adult|one passenger|1 passenger)\b/.test(normalized)) {
    return true;
  }

  return new RegExp(`\\b(${adults}|${numberWord(adults)})\\s+(adult|adults|passenger|passengers|person|people|traveller|travellers|traveler|travelers)\\b`).test(normalized);
}

function numberWord(value: number): string {
  const words: Record<number, string> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
  };
  return words[value] ?? String(value);
}

function containsMention(normalizedText: string, value: string): boolean {
  const normalizedValue = normalizeForMention(value);
  if (!normalizedValue) return false;
  return new RegExp(`\\b${escapeRegExp(normalizedValue)}\\b`).test(normalizedText);
}

function normalizeForMention(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function promptToResumeAfterSideAnswer(
  action: ChatAction,
  draft: PersistedInboundMessage["conversation"]["draft"]
): UiIntent | undefined {
  if (action.type !== "reply" || !draft.expectedField) return undefined;
  return promptForMissingTripField(draft.expectedField);
}

export async function uiIntentFromChatAction(
  action: ChatAction,
  input: {
    conversation: PersistedInboundMessage["conversation"];
    message: WhatsAppInboundMessage;
    options: WhatsAppToolRoutesOptions;
    request?: FastifyRequest;
    showTypingIndicator?: () => Promise<void>;
  }
): Promise<UiIntent | undefined> {
  const userId = requiredUserId(input.conversation);

  if (action.type === "reply") {
    return { type: "text", body: action.message };
  }

  if (action.tool === "sendControlledReply") {
    return controlledReplyIntent(action.input.key);
  }

  if (action.tool === "sendCustomClarification") {
    return customClarificationIntent(action.input);
  }

  if (action.tool === "collectTripDetails") {
    return handleCollectedTripDetails(action.input, input);
  }

  if (action.tool === "startNewTrip") {
    return handleCollectedTripDetails(action.input, { ...input, resetDraft: true });
  }

  if (action.tool === "searchFlights") {
    return withSearchTypingRefresh(input.showTypingIndicator, () =>
      executeSearchFlightsTool({
        userId,
        conversationId: input.conversation.id,
        phoneNumber: input.message.from,
        input: action.input,
        flightSearchHandler: input.options.flightSearchHandler,
        onFailure: createFlightSearchFailureLogger(input.request, input.message),
      })
    );
  }

  return input.options.bookingHandler.createFromFlightSelection({
    userId,
    conversationId: input.conversation.id,
    phoneNumber: input.message.from,
    selectedFlightOptionId: action.input.selectedFlightOptionId,
  });
}

function controlledReplyIntent(key: "skypadi_intro"): UiIntent {
  if (key === "skypadi_intro") {
    return { type: "text", body: SKYPADI_ONBOARDING_MESSAGE };
  }

  return { type: "text", body: SKYPADI_ONBOARDING_MESSAGE };
}

function customClarificationIntent(input: SendCustomClarificationToolInput): UiIntent {
  if (!isSafeCustomClarification(input)) {
    return {
      type: "text",
      body: "I can only help with Nigerian domestic direct flights and simple trip clarifications right now.",
    };
  }

  if (input.widget.type === "reply_buttons") {
    return {
      type: "reply_buttons",
      body: input.body,
      buttons: input.widget.options.map((option) => ({
        id: option.id,
        title: option.title,
      })),
    };
  }

  return {
    type: "flight_list",
    body: input.body,
    buttonText: input.widget.buttonText ?? "Choose",
    rows: input.widget.options,
  };
}

function isSafeCustomClarification(input: SendCustomClarificationToolInput): boolean {
  if (unsafeClarificationBodyPattern.test(input.body)) return false;
  if (input.widget.type === "reply_buttons" && input.widget.options.length > 3) return false;
  if (input.widget.type === "list" && input.widget.options.length > 10) return false;
  if (input.widget.options.length < 1) return false;
  return input.widget.options.every((option) => isSafeCustomClarificationOptionId(option.id));
}

const unsafeClarificationBodyPattern =
  /\b(booked|confirmed|ticket issued|payment|pay|transfer|account|fare|price|fee|baggage|wakanow|supplier|connecting|connection|international)\b|₦|ngn/i;

function isSafeCustomClarificationOptionId(id: string): boolean {
  if (id.startsWith("date:")) {
    return /^date:\d{4}-\d{2}-\d{2}$/.test(id);
  }

  if (id.startsWith("origin:") || id.startsWith("destination:")) {
    const code = id.slice(id.indexOf(":") + 1);
    const airport = airportByCode(code);
    return airport?.country.trim().toLowerCase() === "nigeria";
  }

  if (id.startsWith("departure_window:")) {
    return /^departure_window:(morning|afternoon|evening|anytime)$/.test(id);
  }

  if (id.startsWith("passengers:")) {
    return /^passengers:([1-9]\d?|more)$/.test(id);
  }

  if (id.startsWith("trip_type:")) {
    return /^trip_type:(one_way|return)$/.test(id);
  }

  if (id.startsWith("new_trip:")) {
    return /^new_trip:(start|yes|no)$/.test(id);
  }

  return false;
}

async function handleCollectedTripDetails(
  details: CollectTripDetailsToolInput,
  input: {
    conversation: PersistedInboundMessage["conversation"];
    message: WhatsAppInboundMessage;
    options: WhatsAppToolRoutesOptions;
    request?: FastifyRequest;
    showTypingIndicator?: () => Promise<void>;
    resetDraft?: boolean;
  }
): Promise<UiIntent | undefined> {
  const draft = mergeCollectedTripDetails(input.resetDraft ? {} : input.conversation.draft, details);
  const nextMissingField = firstMissingSearchField(draft);
  const savedConversation = await input.options.conversationRepository.save({
    ...input.conversation,
    draft: {
      ...draft,
      expectedField: nextMissingField,
    },
    updatedAt: new Date(),
  });

  const searchInput = searchInputFromDraft(savedConversation.draft);
  if (searchInput) {
    return withSearchTypingRefresh(input.showTypingIndicator, () =>
      executeSearchFlightsTool({
        userId: requiredUserId(savedConversation),
        conversationId: savedConversation.id,
        phoneNumber: input.message.from,
        input: searchInput,
        flightSearchHandler: input.options.flightSearchHandler,
        onFailure: createFlightSearchFailureLogger(input.request, input.message),
      })
    );
  }

  return nextMissingField ? promptForMissingTripField(nextMissingField) : undefined;
}

async function withSearchTypingRefresh<T>(
  showTypingIndicator: (() => Promise<void>) | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!showTypingIndicator) return operation();

  await showTypingIndicator();
  const refresh = setInterval(() => {
    void showTypingIndicator();
  }, searchTypingRefreshMs);

  try {
    return await operation();
  } finally {
    clearInterval(refresh);
  }
}

function createFlightSearchFailureLogger(
  request: FastifyRequest | undefined,
  message: WhatsAppInboundMessage
): NonNullable<Parameters<typeof executeSearchFlightsTool>[0]["onFailure"]> {
  return (error, context) => {
    request?.log.warn(
      {
        err: error,
        providerMessageId: message.id,
        search: context.input,
        conversationId: context.conversationId,
        userId: context.userId,
        phoneNumber: context.phoneNumber,
      },
      "WhatsApp flight search failed"
    );
  };
}

function mergeCollectedTripDetails(
  draft: PersistedInboundMessage["conversation"]["draft"],
  details: CollectTripDetailsToolInput
): PersistedInboundMessage["conversation"]["draft"] {
  return {
    ...draft,
    ...(details.origin ? { origin: details.origin } : {}),
    ...(details.destination ? { destination: details.destination } : {}),
    ...(details.departureDate ? { departureDate: details.departureDate } : {}),
    ...(details.departureWindow ? { departureWindow: details.departureWindow } : {}),
    ...(details.returnDate ? { returnDate: details.returnDate } : {}),
    ...(details.adults ? { adults: details.adults } : {}),
  };
}

function firstMissingSearchField(
  draft: PersistedInboundMessage["conversation"]["draft"]
): PersistedInboundMessage["conversation"]["draft"]["expectedField"] {
  if (!draft.origin) return "origin";
  if (!draft.destination) return "destination";
  if (!draft.departureDate) return "departure_date";
  if (!draft.adults) return "passengers";
  return undefined;
}

function searchInputFromDraft(
  draft: PersistedInboundMessage["conversation"]["draft"]
): SearchFlightsToolInput | undefined {
  if (!draft.origin || !draft.destination || !draft.departureDate || !draft.adults) return undefined;
  return {
    origin: draft.origin,
    destination: draft.destination,
    departureDate: draft.departureDate,
    departureWindow: draft.departureWindow ?? "anytime",
    ...(draft.returnDate ? { returnDate: draft.returnDate } : {}),
    adults: draft.adults,
  };
}

function promptForMissingTripField(
  field: NonNullable<PersistedInboundMessage["conversation"]["draft"]["expectedField"]>
): UiIntent {
  if (field === "origin") {
    return {
      type: "origin_list",
      body: "Where are you flying from?",
      rows: whatsappOriginRows,
    };
  }

  if (field === "destination") {
    return { type: "text", body: "Where are you flying to?" };
  }

  if (field === "departure_date") {
    return { type: "text", body: "What date do you want to travel?" };
  }

  if (field === "departure_window") {
    return {
      type: "reply_buttons",
      body: "What time of day works best?",
      buttons: [
        { id: "departure_window:morning", title: "Morning" },
        { id: "departure_window:afternoon", title: "Afternoon" },
        { id: "departure_window:evening", title: "Evening" },
      ],
    };
  }

  if (field === "trip_type") {
    return {
      type: "reply_buttons",
      body: "Is this one-way or return?",
      buttons: [
        { id: "trip_type:one_way", title: "One-way" },
        { id: "trip_type:return", title: "Return" },
      ],
    };
  }

  return {
    type: "reply_buttons",
    body: "How many adults are travelling?",
    buttons: [
      { id: "passengers:1", title: "1 adult" },
      { id: "passengers:2", title: "2 adults" },
      { id: "passengers:more", title: "More" },
    ],
  };
}

async function passengerDetailsIntentFromMessage(
  message: WhatsAppInboundMessage,
  conversation: PersistedInboundMessage["conversation"],
  options: WhatsAppToolRoutesOptions
): Promise<UiIntent | undefined> {
  const passenger = passengerFromFlowReply(message);
  if (!passenger) return undefined;
  try {
    return (
      (await options.bookingHandler.collectPassengerDetails({
        userId: requiredUserId(conversation),
        conversationId: conversation.id,
        phoneNumber: message.from,
        text: "",
        passenger,
      })) ?? supplierBookingStartFailureIntent()
    );
  } catch {
    return supplierBookingStartFailureIntent();
  }
}

async function chatContextFromConversation(input: {
  conversation: PersistedInboundMessage["conversation"];
  message: WhatsAppInboundMessage;
  options: WhatsAppToolRoutesOptions;
  includeRecentMessages?: boolean;
}): Promise<ChatContext> {
  const recentMessages = input.includeRecentMessages === false
    ? undefined
    : await loadRecentMessages(input.options.messageRepository, input.conversation.id);
  return {
    conversationId: input.conversation.id,
    userId: requiredUserId(input.conversation),
    phoneNumber: input.message.from,
    conversationStatus: input.conversation.status,
    currentDraft: { ...input.conversation.draft },
    expectedField: input.conversation.draft.expectedField,
    recentMessages,
  };
}

async function loadRecentMessages(
  repository: WhatsAppMessageRepository | undefined,
  conversationId: string
): Promise<ChatContextMessage[] | undefined> {
  const rows = await repository?.listRecentMessages?.({ conversationId, limit: 8 });
  if (!rows?.length) return undefined;

  return dedupeRecentMessages(rows
    .filter((message) => message.textBody?.trim())
    .map((message) => ({
      direction: message.direction,
      textBody: message.textBody,
      receivedAt: message.receivedAt?.toISOString(),
      sentAt: message.sentAt?.toISOString(),
    })));
}

function supplierBookingStartFailureIntent(): UiIntent {
  return {
    type: "text",
    body: "I could not start the supplier booking yet. Please try again shortly.",
  };
}

function dedupeRecentMessages(messages: ChatContextMessage[]): ChatContextMessage[] {
  const deduped: ChatContextMessage[] = [];
  for (const message of messages) {
    const previous = deduped.at(-1);
    if (
      previous &&
      previous.direction === message.direction &&
      normalizedMessageText(previous.textBody) === normalizedMessageText(message.textBody)
    ) {
      deduped[deduped.length - 1] = message;
      continue;
    }

    deduped.push(message);
  }

  return deduped;
}

function normalizedMessageText(text: string | undefined): string {
  return text?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function passengerFromFlowReply(message: WhatsAppInboundMessage): Passenger | undefined {
  if (!isPassengerDetailsFlowReply(message)) return undefined;
  const responseJson = message.interactive.nfm_reply?.response_json;
  if (!responseJson) return undefined;
  try {
    const data = JSON.parse(responseJson) as Record<string, unknown>;
    return {
      title: stringValue(data.title) as Passenger["title"],
      firstName: stringValue(data.firstName) ?? stringValue(data.first_name) ?? "",
      middleName: stringValue(data.middleName) ?? stringValue(data.middle_name),
      lastName: stringValue(data.lastName) ?? stringValue(data.last_name) ?? "",
      dateOfBirth: stringValue(data.dateOfBirth) ?? stringValue(data.date_of_birth) ?? "",
      nationality: stringValue(data.nationality) ?? "Nigerian",
      gender: stringValue(data.gender) as Passenger["gender"],
      phone: stringValue(data.phone) ?? stringValue(data.phoneNumber) ?? stringValue(data.phone_number) ?? "",
      email: stringValue(data.email) ?? "",
    };
  } catch {
    return undefined;
  }
}

function isPassengerDetailsFlowReply(
  message: WhatsAppInboundMessage
): message is WhatsAppInboundMessage & { interactive: { type: "nfm_reply"; nfm_reply?: { response_json?: string; body?: string } } } {
  return message.type === "interactive" && message.interactive?.type === "nfm_reply";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function selectedFlightOptionIdFromMessage(message: WhatsAppInboundMessage): string | undefined {
  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  return selectedFlightOptionIdFromReplyId(replyId);
}

function passengerActionFromMessage(message: WhatsAppInboundMessage): "use_default" | "different" | undefined {
  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  return passengerActionFromReplyId(replyId);
}

function tripDetailsFromInteractiveReply(message: WhatsAppInboundMessage): CollectTripDetailsToolInput | undefined {
  if (message.type !== "interactive") return undefined;

  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  if (!replyId) return undefined;

  if (replyId.startsWith("origin:")) {
    return { origin: replyId.slice("origin:".length) };
  }

  if (replyId.startsWith("destination:")) {
    return { destination: replyId.slice("destination:".length) };
  }

  if (replyId.startsWith("date:")) {
    return { departureDate: replyId.slice("date:".length) };
  }

  if (replyId.startsWith("departure_window:")) {
    return { departureWindow: replyId.slice("departure_window:".length) };
  }

  if (replyId.startsWith("passengers:")) {
    const value = replyId.slice("passengers:".length);
    if (value === "more") return undefined;
    const adults = Number(value);
    return Number.isInteger(adults) && adults > 0 ? { adults } : undefined;
  }

  return undefined;
}

function chatTextFromMessage(message: WhatsAppInboundMessage): string | undefined {
  if (message.type === "text" && message.text?.body?.trim()) {
    return message.text.body.trim();
  }

  if (message.type !== "interactive") return undefined;

  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  if (!replyId) return undefined;
  const title = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;

  if (replyId.startsWith("origin:")) {
    return selectedReplyText("Origin selected", replyId.slice("origin:".length), title);
  }
  if (replyId.startsWith("destination:")) {
    return selectedReplyText("Destination selected", replyId.slice("destination:".length), title);
  }
  if (replyId.startsWith("date:")) {
    return selectedReplyText("Date selected", replyId.slice("date:".length), title);
  }
  if (replyId.startsWith("trip_type:")) {
    return selectedReplyText("Trip type selected", replyId.slice("trip_type:".length), title);
  }
  if (replyId.startsWith("departure_window:")) {
    return selectedReplyText("Departure window selected", replyId.slice("departure_window:".length), title);
  }
  if (replyId.startsWith("passengers:")) {
    return selectedReplyText("Passengers selected", replyId.slice("passengers:".length), title);
  }
  if (replyId.startsWith("new_trip:")) {
    return selectedReplyText("New trip selected", replyId.slice("new_trip:".length), title);
  }

  return selectedReplyText("Selected", replyId, title);
}

function selectedReplyText(prefix: string, value: string, title: string | undefined): string {
  const trimmedTitle = title?.trim();
  return trimmedTitle ? `${prefix}: ${value} (${trimmedTitle})` : `${prefix}: ${value}`;
}

function requiredUserId(conversation: PersistedInboundMessage["conversation"]): string {
  if (!conversation.userId) {
    throw new Error("Persisted WhatsApp conversation is missing userId");
  }
  return conversation.userId;
}

async function sendIntentReply(
  intent: UiIntent,
  conversationId: string,
  message: WhatsAppInboundMessage,
  options: WhatsAppToolRoutesOptions
): Promise<void> {
  const outboundMessage = mapUiIntentToWhatsAppMessage(intent);
  await options.whatsappClient.sendMessage({
    to: message.from,
    message: outboundMessage,
  });
  await recordOutboundMessage({
    conversationId,
    intent,
    message: outboundMessage,
    options,
  });
}

async function recordOutboundMessage(input: {
  conversationId: string;
  intent: UiIntent;
  message: WhatsAppMessagePayload;
  options: WhatsAppToolRoutesOptions;
}): Promise<void> {
  await input.options.messageRepository?.recordOutboundMessage?.({
    conversationId: input.conversationId,
    textBody: input.intent.body,
    payload: input.message as unknown as Record<string, unknown>,
    sentAt: new Date(),
  });
}

function extractMessages(payload: unknown): WhatsAppInboundMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  return payload.entry.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) return [];
    return entry.changes.flatMap((change) => {
      if (!isRecord(change)) return [];
      const value = change.value;
      if (!isRecord(value) || !Array.isArray(value.messages)) return [];
      return value.messages.filter(isWhatsAppInboundMessage);
    });
  });
}

function isWhatsAppInboundMessage(value: unknown): value is WhatsAppInboundMessage {
  return isRecord(value) && typeof value.id === "string" && typeof value.from === "string" && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type MetaSignatureValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_signature" | "invalid_signature_format" | "signature_mismatch";
      hasRawBody: boolean;
      hasSignature: boolean;
    };

function validateMetaSignature(request: RawBodyRequest, appSecret: string): MetaSignatureValidation {
  const signature = headerValue(request.headers["x-hub-signature-256"]);
  const hasRawBody = request.rawBody !== undefined;
  if (!signature) {
    return { ok: false, reason: "missing_signature", hasRawBody, hasSignature: false };
  }
  if (!signature.startsWith("sha256=")) {
    return { ok: false, reason: "invalid_signature_format", hasRawBody, hasSignature: true };
  }

  const digest = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    return { ok: false, reason: "invalid_signature_format", hasRawBody, hasSignature: true };
  }

  const raw = rawPayloadBuffer(request);
  const actual = Buffer.from(digest, "hex");
  const expected = createHmac("sha256", appSecret).update(raw).digest();

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "signature_mismatch", hasRawBody, hasSignature: true };
  }

  return { ok: true };
}

function rawPayloadBuffer(request: RawBodyRequest): Buffer {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.rawBody === "string") return Buffer.from(request.rawBody, "utf8");
  return Buffer.from(JSON.stringify(request.body ?? {}), "utf8");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
