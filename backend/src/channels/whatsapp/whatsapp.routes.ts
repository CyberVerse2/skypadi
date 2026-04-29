import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { mapUiIntentToWhatsAppMessage } from "./whatsapp.mapper.js";
import type { WhatsAppClient } from "./whatsapp.client.js";
import type { Passenger } from "../../schemas/flight-booking.js";
import { handleConversationEvent } from "../../workflows/conversation.workflow.js";
import {
  findOrCreateConversation,
  type ConversationRepository,
} from "../../domain/conversation/conversation.service.js";
import type { WhatsAppMessageRepository } from "../../domain/conversation/conversation.repository.js";
import type { UiIntent } from "./whatsapp.types.js";

export type WhatsAppRoutesOptions = {
  verifyToken: string;
  conversationRepository: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient: WhatsAppClient;
  appSecret?: string;
  flightSearchHandler?: FlightSearchHandler;
  bookingHandler?: BookingSelectionHandler;
};

export type FlightSearchHandler = {
  searchAndPresent(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    search: {
      origin: string;
      destination: string;
      departureDate: string;
      departureWindow: string;
      tripType: "one_way" | "return";
      returnDate?: string;
      adults: number;
    };
  }): Promise<UiIntent>;
};

export type BookingSelectionHandler = {
  createFromFlightSelection(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    selectedFlightOptionId: string;
  }): Promise<UiIntent>;
  collectPassengerDetails?(input: {
    userId: string;
    conversationId: string;
    phoneNumber: string;
    text: string;
    passenger?: Passenger;
  }): Promise<UiIntent | undefined>;
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

export function registerWhatsAppWorkflowRoutes(app: FastifyInstance, options: WhatsAppRoutesOptions): void {
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

async function handleWebhook(request: RawBodyRequest, reply: FastifyReply, options: WhatsAppRoutesOptions) {
  if (options.appSecret && !isValidMetaSignature(request, options.appSecret)) {
    return reply.status(401).send({ error: "invalid_signature" });
  }

  const messages = extractMessages(request.body);
  const persistedMessages = await persistInboundMessages(messages, options);

  void processMessages(persistedMessages, options, request).catch((error) => {
    request.log.error({ err: error }, "WhatsApp webhook processing failed");
  });

  return reply.send({ ok: true, received: persistedMessages.length });
}

type PersistedInboundMessage = {
  message: WhatsAppInboundMessage;
  now: Date;
  conversation: Awaited<ReturnType<ConversationRepository["save"]>>;
};

async function persistInboundMessages(
  messages: WhatsAppInboundMessage[],
  options: WhatsAppRoutesOptions
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
      textBody: message.text?.body,
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
  options: WhatsAppRoutesOptions,
  request: FastifyRequest
): Promise<void> {
  for (const { message, now, conversation } of persistedMessages) {
    const selectedFlightOptionId = selectedFlightOptionIdFromMessage(message);
    if (selectedFlightOptionId) {
      await sendBookingSelectionReply(selectedFlightOptionId, conversation, message, options);
      continue;
    }

    const bookingIntent = await passengerDetailsIntentFromMessage(message, conversation, options);
    if (bookingIntent) {
      await options.whatsappClient.sendMessage({
        to: message.from,
        message: mapUiIntentToWhatsAppMessage(bookingIntent),
      });
      request.log.info({ providerMessageId: message.id, resultKind: "booking_passenger_details" }, "Processed WhatsApp booking message");
      continue;
    }

    const event = normalizeConversationEvent(message, now);
    if (!event) continue;

    const result = await handleConversationEvent(event, {
      conversationRepository: options.conversationRepository,
    });
    const intent = await uiIntentFromWorkflowResult(result, conversation, message, options);
    if (!intent) continue;

    await options.whatsappClient.sendMessage({
      to: message.from,
      message: mapUiIntentToWhatsAppMessage(intent),
    });
    request.log.info({ providerMessageId: message.id, resultKind: result.kind }, "Processed WhatsApp message");
  }
}

async function passengerDetailsIntentFromMessage(
  message: WhatsAppInboundMessage,
  conversation: PersistedInboundMessage["conversation"],
  options: WhatsAppRoutesOptions
): Promise<UiIntent | undefined> {
  if (!conversation.userId) return undefined;
  const text = message.type === "text" ? message.text?.body : undefined;
  const passenger = passengerFromFlowReply(message);
  if (!text && !passenger) return undefined;
  return options.bookingHandler?.collectPassengerDetails?.({
    userId: conversation.userId,
    conversationId: conversation.id,
    phoneNumber: message.from,
    text: text ?? "",
    passenger,
  });
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

function normalizeConversationEvent(message: WhatsAppInboundMessage, now: Date) {
  if (message.type === "text" && message.text?.body) {
    return {
      type: "inbound_text" as const,
      contact: { phoneNumber: message.from },
      text: message.text.body,
      providerMessageId: message.id,
      now,
    };
  }

  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  if (message.type === "interactive" && replyId) {
    return {
      type: "interactive_reply" as const,
      contact: { phoneNumber: message.from },
      replyId,
      providerMessageId: message.id,
      now,
    };
  }

  return undefined;
}

async function uiIntentFromWorkflowResult(
  result: Awaited<ReturnType<typeof handleConversationEvent>>,
  conversation: PersistedInboundMessage["conversation"],
  message: WhatsAppInboundMessage,
  options: WhatsAppRoutesOptions
): Promise<UiIntent | undefined> {
  if (result.kind === "needs_user_input") {
    return result.ui as UiIntent;
  }

  if (result.kind === "ok") {
    if (!options.flightSearchHandler || !conversation.userId) {
      return { type: "text", body: "I have enough details to search flights now." };
    }

    return options.flightSearchHandler.searchAndPresent({
      userId: conversation.userId,
      conversationId: conversation.id,
      phoneNumber: message.from,
      search: result.value.search,
    });
  }

  return { type: "text", body: "I could not process that yet. Please try again." };
}

async function sendBookingSelectionReply(
  selectedFlightOptionId: string,
  conversation: PersistedInboundMessage["conversation"],
  message: WhatsAppInboundMessage,
  options: WhatsAppRoutesOptions
): Promise<void> {
  if (!options.bookingHandler || !conversation.userId) {
    await options.whatsappClient.sendMessage({
      to: message.from,
      message: mapUiIntentToWhatsAppMessage({
        type: "text",
        body: "I found that flight. I need a little more setup before I can create the booking.",
      }),
    });
    return;
  }

  const intent = await options.bookingHandler.createFromFlightSelection({
    userId: conversation.userId,
    conversationId: conversation.id,
    phoneNumber: message.from,
    selectedFlightOptionId,
  });
  await options.whatsappClient.sendMessage({
    to: message.from,
    message: mapUiIntentToWhatsAppMessage(intent),
  });
}

function selectedFlightOptionIdFromMessage(message: WhatsAppInboundMessage): string | undefined {
  const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  const prefix = "flight_option:";
  if (!replyId?.startsWith(prefix)) return undefined;
  return replyId.slice(prefix.length);
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

function isValidMetaSignature(request: RawBodyRequest, appSecret: string): boolean {
  const signature = headerValue(request.headers["x-hub-signature-256"]);
  if (!signature?.startsWith("sha256=")) return false;

  const raw = rawPayload(request);
  const expected = `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
}

function rawPayload(request: RawBodyRequest): string {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString("utf8");
  if (typeof request.rawBody === "string") return request.rawBody;
  return JSON.stringify(request.body ?? {});
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
