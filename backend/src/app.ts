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
import { collectPassengerDetailsAndCreateSupplierHold, createBookingFromSelectedOption } from "./workflows/booking.workflow.js";
import { createDrizzleBookingRepository } from "./domain/booking/booking.repository.js";
import type { BookingSelectionHandler, FlightSearchHandler } from "./channels/whatsapp/whatsapp.routes.js";
import { createDrizzleSupplierBookingRepository } from "./workflows/supplier-booking.workflow.js";
import { createWakanowBrowserHoldClient, type WakanowHoldClient } from "./integrations/wakanow/wakanow.booking.js";
import type { UiIntent } from "./channels/whatsapp/whatsapp.types.js";
import { createOpenAIIntentExtractor, type IntentExtractor } from "./agent/intent-extractor.js";

export type BuildServerOptions = {
  whatsappVerifyToken?: string;
  resendWebhookSecret?: string;
  whatsappAppSecret?: string;
  conversationRepository?: ConversationRepository;
  messageRepository?: WhatsAppMessageRepository;
  whatsappClient?: WhatsAppClient;
  intentExtractor?: IntentExtractor;
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
        registerWhatsAppWorkflowRoutes(webhookRoutes, {
          verifyToken: whatsappVerifyToken,
          conversationRepository,
          messageRepository: options.messageRepository ?? messageRepositoryFromConversationRepository(conversationRepository),
          whatsappClient,
          intentExtractor: options.intentExtractor ?? createLiveIntentExtractor(),
          appSecret: options.whatsappAppSecret ?? env.WHATSAPP_APP_SECRET,
          flightSearchHandler: options.flightSearchHandler ?? createLiveFlightSearchHandler(),
          bookingHandler: options.bookingHandler ?? createLiveBookingHandler(options.supplierClient),
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
    defaults: { currency: env.WAKANOW_CURRENCY, timezone: env.WAKANOW_TIMEZONE }
  }));

  return app;
}

function createLiveIntentExtractor(): IntentExtractor {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when WhatsApp routes are enabled");
  }

  return createOpenAIIntentExtractor({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_INTENT_MODEL,
  });
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

function createLiveBookingHandler(supplierClient?: WakanowHoldClient): BookingSelectionHandler {
  if (!env.RESEND_INBOUND_DOMAIN) {
    throw new Error("RESEND_INBOUND_DOMAIN is required when WhatsApp booking is enabled");
  }

  if (!env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID) {
    throw new Error("WHATSAPP_PASSENGER_DETAILS_FLOW_ID is required when WhatsApp booking is enabled");
  }

  const inboundDomain = env.RESEND_INBOUND_DOMAIN;
  const passengerDetailsFlowId = env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID;

  return {
    async createFromFlightSelection(input) {
      const result = await createBookingFromSelectedOption({
        userId: input.userId,
        conversationId: input.conversationId,
        selectedFlightOptionId: input.selectedFlightOptionId,
        inboundDomain,
        repository: createDrizzleBookingRepository(db),
      });

      if (result.kind !== "ok") {
        return { type: "text", body: "I could not create that booking yet. Please try another flight." };
      }

      return {
        type: "passenger_details_flow",
        body: "Great choice. I need the passenger details to continue.",
        buttonText: "Enter details",
        flowId: passengerDetailsFlowId,
        flowToken: result.value.id,
        data: {
          bookingId: result.value.id,
          selectedFlightOptionId: result.value.selectedFlightOptionId,
        },
      };
    },
    async collectPassengerDetails(input) {
      const result = await collectPassengerDetailsAndCreateSupplierHold({
        userId: input.userId,
        conversationId: input.conversationId,
        passenger: input.passenger,
        repository: createDrizzleBookingRepository(db),
        supplierClient: supplierClient ?? createWakanowBrowserHoldClient({ db }),
        supplierRepository: createDrizzleSupplierBookingRepository(db),
      });

      if (result.kind === "needs_user_input") return result.ui as UiIntent;
      if (result.kind === "needs_manual_review") {
        return {
          type: "text",
          body: "I could not confirm the supplier booking automatically. I have moved it to manual review.",
        };
      }
      if (result.kind !== "ok") return undefined;

      const decision = result.value;
      if (decision.status === "awaiting_payment_for_hold") {
        return {
          type: "text",
          body: `Wakanow hold created. Reference: ${decision.supplierBookingRef}. Hold expires at ${decision.holdExpiresAt?.toLocaleString("en-NG", { timeZone: env.WAKANOW_TIMEZONE })}.`,
        };
      }
      if (decision.status === "payment_pending") {
        return {
          type: "text",
          body: "This flight requires payment before ticketing. I have saved the booking details.",
        };
      }
      return {
        type: "text",
        body: "I could not confirm the supplier booking automatically. I have moved it to manual review.",
      };
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
