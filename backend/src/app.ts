import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { env } from "./config";
import { flightSearchRequestSchema } from "./schemas/flight-search";
import { WakanowApiSearchError, searchFlightsApi } from "./integrations/wakanow/api-search";
import { wakanowConfig } from "./integrations/wakanow/wakanow.config";
import { createWhatsAppCloudClient, type WhatsAppClient } from "./channels/whatsapp/whatsapp.client";
import { registerWhatsAppToolRoutes } from "./channels/whatsapp/whatsapp.tool-routes";
import { registerResendWebhookRoutes } from "./integrations/resend/webhook.routes";
import { db } from "./db/client";
import { createDrizzleConversationRepository } from "./domain/conversation/conversation.repository";
import type { ConversationRepository, WhatsAppMessageRepository } from "./domain/conversation/conversation.types";
import { createFlightSearchPresentationHandler } from "./workflows/flight-search.workflow";
import { createLiveBookingHandler } from "./channels/whatsapp/live-booking.handler";
import type { BookingSelectionHandler, FlightSearchHandler } from "./channels/whatsapp/whatsapp.handlers";
import type { WakanowHoldClient } from "./integrations/wakanow/wakanow.types";
import type { IntentExtractor } from "./agent/intent-extractor";
import { createOpenAIChatModel, type ChatModel } from "./tools/chat-agent";

export type BuildServerOptions = {
  whatsappVerifyToken?: string;
  resendWebhookSecret?: string;
  whatsappAppSecret?: string;
  conversationRepository?: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient?: WhatsAppClient;
  intentExtractor?: IntentExtractor;
  chatModel?: ChatModel;
  flightSearchHandler?: FlightSearchHandler;
  bookingHandler?: BookingSelectionHandler;
  supplierClient?: WakanowHoldClient;
};

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: true });
  const conversationRepository = options.conversationRepository ?? createDrizzleConversationRepository(db);
  const whatsappVerifyToken = options.whatsappVerifyToken ?? env.WHATSAPP_VERIFY_TOKEN;
  const resendWebhookSecret = options.resendWebhookSecret ?? env.RESEND_WEBHOOK_SECRET;

  if (whatsappVerifyToken || resendWebhookSecret) {
    app.register(async (webhookRoutes) => {
      await webhookRoutes.register(fastifyRawBody, {
        field: "rawBody",
        global: false,
        encoding: "utf8",
        runFirst: true,
      });

      if (whatsappVerifyToken) {
        const whatsappClient = options.whatsappClient ?? configuredWhatsAppClient();
        registerWhatsAppToolRoutes(webhookRoutes, {
          verifyToken: whatsappVerifyToken,
          conversationRepository,
          messageRepository: options.messageRepository ?? messageRepositoryFromConversationRepository(conversationRepository),
          whatsappClient,
          appSecret: options.whatsappAppSecret ?? env.WHATSAPP_APP_SECRET,
          chatModel: options.chatModel ?? createOpenAIChatModel({
            apiKey: requireOpenAIApiKey(),
            model: env.OPENAI_INTENT_MODEL,
          }),
          flightSearchHandler: options.flightSearchHandler ?? createLiveFlightSearchHandler(),
          bookingHandler: options.bookingHandler ?? createConfiguredLiveBookingHandler(),
        });
      }

      if (resendWebhookSecret) {
        registerResendWebhookRoutes(webhookRoutes, {
          webhookSecret: resendWebhookSecret,
          resendApiKey: env.RESEND_API_KEY,
        });
      }
    });
  }

  app.get("/health", async () => ({
    status: "ok",
    provider: "wakanow",
    time: new Date().toISOString()
  }));

  app.post("/api/flights/search", async (request, reply) => {
    try {
      const payload = flightSearchRequestSchema.parse(request.body);
      const result = await searchFlightsApi(payload);
      return reply.send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: "invalid_request", issues: error.issues });
      }
      if (error instanceof WakanowApiSearchError) {
        request.log.warn({ err: error }, "Wakanow search failed");
        return reply.status(502).send({
          error: "wakanow_search_failed",
          message: error.message,
          details: error.details ?? null
        });
      }
      request.log.error({ err: error }, "Unexpected flight search failure");
      return reply.status(500).send({ error: "internal_error", message: "Unexpected server error" });
    }
  });

  app.get("/", async () => ({
    name: "skypadi-backend",
    endpoints: ["/health", "/api/flights/search", "/webhooks/whatsapp", "/webhooks/resend"],
    defaults: { currency: wakanowConfig.currency, timezone: wakanowConfig.timezone }
  }));

  return app;
}

function requireOpenAIApiKey(): string {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when WhatsApp routes are enabled");
  }

  return env.OPENAI_API_KEY;
}

function createLiveFlightSearchHandler(): FlightSearchHandler {
  return createFlightSearchPresentationHandler({
    db,
    provider: {
      search: searchFlightsApi,
    },
    displayTimeZone: wakanowConfig.timezone,
  });
}

function createConfiguredLiveBookingHandler(): BookingSelectionHandler {
  if (!env.RESEND_INBOUND_DOMAIN) {
    throw new Error("RESEND_INBOUND_DOMAIN is required when WhatsApp booking is enabled");
  }

  if (!env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID) {
    throw new Error("WHATSAPP_PASSENGER_DETAILS_FLOW_ID is required when WhatsApp booking is enabled");
  }

  return createLiveBookingHandler({
    db,
    inboundDomain: env.RESEND_INBOUND_DOMAIN,
    passengerDetailsFlowId: env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID,
    displayTimeZone: wakanowConfig.timezone,
  });
}

function configuredWhatsAppClient(): WhatsAppClient {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WhatsApp routes are enabled");
  }

  return createWhatsAppCloudClient({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  });
}

function messageRepositoryFromConversationRepository(
  repository: ConversationRepository
): WhatsAppMessageRepository | undefined {
  if ("recordInboundMessage" in repository && typeof repository.recordInboundMessage === "function") {
    return repository as ConversationRepository & WhatsAppMessageRepository;
  }

  return undefined;
}
