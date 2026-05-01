import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { mapUiIntentToWhatsAppMessage } from "./whatsapp.mapper";
import type { WhatsAppClient } from "./whatsapp.client";
import type { UiIntent } from "./whatsapp.types";
import type { Passenger } from "../../schemas/flight-booking";
import { findOrCreateConversation } from "../../domain/conversation/conversation.service";
import type { ConversationRepository, WhatsAppMessageRepository } from "../../domain/conversation/conversation.types";
import { decideChatActionWithModel, type ChatModel } from "../../tools/chat-agent";
import type { ChatAction, ChatContext, ChatContextMessage } from "../../tools/chat-tool.types";
import { executeSearchFlightsTool } from "../../tools/search-flights.tool";
import type { BookingSelectionHandler, FlightSearchHandler } from "./whatsapp.routes";

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
    const selectedFlightOptionId = selectedFlightOptionIdFromMessage(message);
    if (selectedFlightOptionId) {
      await sendIntentReply(
        await options.bookingHandler.createFromFlightSelection({
          userId: requiredUserId(conversation),
          conversationId: conversation.id,
          phoneNumber: message.from,
          selectedFlightOptionId,
        }),
        message,
        options
      );
      request.log.info({ providerMessageId: message.id, resultKind: "booking_selection" }, "Processed WhatsApp booking message");
      continue;
    }

    const bookingIntent = await passengerDetailsIntentFromMessage(message, conversation, options);
    if (bookingIntent) {
      await sendIntentReply(bookingIntent, message, options);
      request.log.info({ providerMessageId: message.id, resultKind: "booking_passenger_details" }, "Processed WhatsApp booking message");
      continue;
    }

    const userText = chatTextFromMessage(message);
    if (!userText) continue;

    const action = await decideChatActionWithModel(options.chatModel, {
      userText,
      now,
      context: await chatContextFromConversation({ conversation, message, options }),
    });

    const intent = await uiIntentFromChatAction(action, {
      conversation,
      message,
      options,
    });
    if (!intent) continue;

    await sendIntentReply(intent, message, options);
    request.log.info({ providerMessageId: message.id, resultKind: action.type }, "Processed WhatsApp tool message");
  }
}

export async function uiIntentFromChatAction(
  action: ChatAction,
  input: {
    conversation: PersistedInboundMessage["conversation"];
    message: WhatsAppInboundMessage;
    options: WhatsAppToolRoutesOptions;
  }
): Promise<UiIntent | undefined> {
  const userId = requiredUserId(input.conversation);

  if (action.type === "reply") {
    return { type: "text", body: action.message };
  }

  if (action.tool === "searchFlights") {
    return executeSearchFlightsTool({
      userId,
      conversationId: input.conversation.id,
      phoneNumber: input.message.from,
      input: action.input,
      flightSearchHandler: input.options.flightSearchHandler,
    });
  }

  return input.options.bookingHandler.createFromFlightSelection({
    userId,
    conversationId: input.conversation.id,
    phoneNumber: input.message.from,
    selectedFlightOptionId: action.input.selectedFlightOptionId,
  });
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
}): Promise<ChatContext> {
  const recentMessages = await loadRecentMessages(input.options.messageRepository, input.conversation.id);
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

  return rows
    .filter((message) => message.textBody?.trim())
    .map((message) => ({
      direction: message.direction,
      textBody: message.textBody,
      receivedAt: message.receivedAt?.toISOString(),
      sentAt: message.sentAt?.toISOString(),
    }));
}

function supplierBookingStartFailureIntent(): UiIntent {
  return {
    type: "text",
    body: "I could not start the supplier booking yet. Please try again shortly.",
  };
}

function passengerFromFlowReply(message: WhatsAppInboundMessage): Passenger | undefined {
  if (message.type !== "interactive" || message.interactive?.type !== "nfm_reply") return undefined;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function selectedFlightOptionIdFromMessage(message: WhatsAppInboundMessage): string | undefined {
  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  const prefix = "flight_option:";
  if (!replyId?.startsWith(prefix)) return undefined;
  return replyId.slice(prefix.length);
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
  if (replyId.startsWith("trip_type:")) {
    return selectedReplyText("Trip type selected", replyId.slice("trip_type:".length), title);
  }
  if (replyId.startsWith("passengers:")) {
    return selectedReplyText("Passengers selected", replyId.slice("passengers:".length), title);
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
  message: WhatsAppInboundMessage,
  options: WhatsAppToolRoutesOptions
): Promise<void> {
  await options.whatsappClient.sendMessage({
    to: message.from,
    message: mapUiIntentToWhatsAppMessage(intent),
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
