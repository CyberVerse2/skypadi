import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { env } from "./config.js";
import { flightSearchRequestSchema } from "./schemas/flight-search.js";
import { WakanowApiSearchError, searchFlightsApi } from "./integrations/wakanow/api-search.js";
import { createWhatsAppCloudClient, type WhatsAppClient } from "./channels/whatsapp/whatsapp.client.js";
import { registerWhatsAppWorkflowRoutes } from "./channels/whatsapp/whatsapp.routes.js";
import { registerResendWebhookRoutes } from "./integrations/resend/webhook.routes.js";
import { db } from "./db/client.js";
import {
  createDrizzleConversationRepository,
  type WhatsAppMessageRepository,
} from "./domain/conversation/conversation.repository.js";
import type { ConversationRepository } from "./domain/conversation/conversation.service.js";
import { createFlightSearchPresentationHandler } from "./workflows/flight-search.workflow.js";
import { createBookingFromSelectedOption } from "./workflows/booking.workflow.js";
import { createDrizzleBookingRepository } from "./domain/booking/booking.repository.js";
import type { BookingSelectionHandler, FlightSearchHandler } from "./channels/whatsapp/whatsapp.routes.js";

export type BuildServerOptions = {
  whatsappVerifyToken?: string;
  resendWebhookSecret?: string;
  whatsappAppSecret?: string;
  conversationRepository?: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient?: WhatsAppClient;
  flightSearchHandler?: FlightSearchHandler;
  bookingHandler?: BookingSelectionHandler;
};

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: true });
  app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true
  });
  const conversationRepository = options.conversationRepository ?? createDrizzleConversationRepository(db);
  const whatsappVerifyToken = options.whatsappVerifyToken ?? env.WHATSAPP_VERIFY_TOKEN;
  if (whatsappVerifyToken) {
    const whatsappClient = options.whatsappClient ?? configuredWhatsAppClient();
    registerWhatsAppWorkflowRoutes(app, {
      verifyToken: whatsappVerifyToken,
      conversationRepository,
      messageRepository: options.messageRepository ?? messageRepositoryFromConversationRepository(conversationRepository),
      whatsappClient,
      appSecret: options.whatsappAppSecret ?? env.WHATSAPP_APP_SECRET,
      flightSearchHandler: options.flightSearchHandler ?? createLiveFlightSearchHandler(),
      bookingHandler: options.bookingHandler ?? createLiveBookingHandler(),
    });
  }
  const resendWebhookSecret = options.resendWebhookSecret ?? env.RESEND_WEBHOOK_SECRET;
  if (resendWebhookSecret) {
    registerResendWebhookRoutes(app, { webhookSecret: resendWebhookSecret, resendApiKey: env.RESEND_API_KEY });
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
    defaults: { currency: env.WAKANOW_CURRENCY, timezone: env.WAKANOW_TIMEZONE }
  }));

  return app;
}

function createLiveFlightSearchHandler(): FlightSearchHandler {
  return createFlightSearchPresentationHandler({
    db,
    provider: {
      search: searchFlightsApi,
    },
    displayTimeZone: env.WAKANOW_TIMEZONE,
  });
}

function createLiveBookingHandler(): BookingSelectionHandler {
  return {
    async createFromFlightSelection(input) {
      if (!env.RESEND_INBOUND_DOMAIN) {
        return { type: "text", body: "Booking email aliases are not configured yet." };
      }

      const result = await createBookingFromSelectedOption({
        userId: input.userId,
        conversationId: input.conversationId,
        selectedFlightOptionId: input.selectedFlightOptionId,
        inboundDomain: env.RESEND_INBOUND_DOMAIN,
        repository: createDrizzleBookingRepository(db),
      });

      if (result.kind !== "ok") {
        return { type: "text", body: "I could not create that booking yet. Please try another flight." };
      }

      return { type: "text", body: "Booking created. Please send passenger details." };
    },
  };
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
