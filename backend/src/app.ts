import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { env } from "./config";
import { flightSearchRequestSchema } from "./schemas/flight-search";
import { WakanowApiSearchError, searchFlightsApi } from "./integrations/wakanow/api-search";
import { createWhatsAppCloudClient, type WhatsAppClient } from "./channels/whatsapp/whatsapp.client";
import { registerWhatsAppToolRoutes } from "./channels/whatsapp/whatsapp.tool-routes";
import { registerResendWebhookRoutes } from "./integrations/resend/webhook.routes";
import { db } from "./db/client";
import { createDrizzleConversationRepository } from "./domain/conversation/conversation.repository";
import type { ConversationRepository, WhatsAppMessageRepository } from "./domain/conversation/conversation.types";
import { createFlightSearchPresentationHandler } from "./workflows/flight-search.workflow";
import {
  collectDefaultPassengerAndQueueSupplierBooking,
  collectPassengerDetailsAndQueueSupplierBooking,
  createBookingFromSelectedOption,
} from "./workflows/booking.workflow";
import { createDrizzleBookingRepository } from "./domain/booking/booking.repository";
import type { BookingSelectionHandler, FlightSearchHandler } from "./channels/whatsapp/whatsapp.routes";
import type { WakanowHoldClient } from "./integrations/wakanow/wakanow.booking";
import type { UiIntent } from "./channels/whatsapp/whatsapp.types";
import type { IntentExtractor } from "./agent/intent-extractor";
import { createOpenAIChatModel, type ChatModel } from "./tools/chat-agent";
import { createDrizzleSupplierBookingJobRepository } from "./jobs/booking-job.repository";
import { enqueueSupplierBookingJob } from "./jobs/booking-queue";
import { bookingSummaryPassengerFlowBody, type BookingSummaryDetails } from "./workflows/booking-summary";

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
          bookingHandler: options.bookingHandler ?? createLiveBookingHandler(),
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
    displayTimeZone: env.WAKANOW_TIMEZONE,
  });
}

function createLiveBookingHandler(): BookingSelectionHandler {
  if (!env.RESEND_INBOUND_DOMAIN) {
    throw new Error("RESEND_INBOUND_DOMAIN is required when WhatsApp booking is enabled");
  }

  if (!env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID) {
    throw new Error("WHATSAPP_PASSENGER_DETAILS_FLOW_ID is required when WhatsApp booking is enabled");
  }

  const inboundDomain = env.RESEND_INBOUND_DOMAIN;
  const passengerDetailsFlowId = env.WHATSAPP_PASSENGER_DETAILS_FLOW_ID;
  const repository = createDrizzleBookingRepository(db);

  return {
    async createFromFlightSelection(input) {
      const result = await createBookingFromSelectedOption({
        userId: input.userId,
        conversationId: input.conversationId,
        selectedFlightOptionId: input.selectedFlightOptionId,
        inboundDomain,
        repository,
      });

      if (result.kind !== "ok") {
        return { type: "text", body: "I could not create that booking yet. Please try another flight." };
      }

      const summary = await findBookingSummaryForSelectedFlight(result.value.selectedFlightOptionId).catch(() => undefined);
      const passenger = await repository.findDefaultPassengerForUser?.(input.userId);

      if (passenger) {
        const name = `${passenger.passenger.firstName} ${passenger.passenger.lastName}`;
        return {
          type: "reply_buttons",
          body: [
            summary
              ? bookingSummaryPassengerFlowBody({
                  summary,
                  passengerPrompt: `Continue booking for ${name}?`,
                })
              : `Continue booking for ${name}?`,
          ].join("\n"),
          buttons: [
            { id: "passenger:use_default", title: `Use ${passenger.passenger.firstName}`.slice(0, 20) },
            { id: "passenger:different", title: "Different passenger" },
          ],
        };
      }

      return passengerDetailsFlowIntent({
        bookingId: result.value.id,
        selectedFlightOptionId: result.value.selectedFlightOptionId,
        body: summary
          ? bookingSummaryPassengerFlowBody({
              summary,
              passengerPrompt: "I need the passenger details to continue.",
            })
          : "Great choice. I need the passenger details to continue.",
        passengerDetailsFlowId,
      });
    },
    async collectPassengerDetails(input) {
      const result = await collectPassengerDetailsAndQueueSupplierBooking({
        userId: input.userId,
        conversationId: input.conversationId,
        passenger: input.passenger,
        repository,
        jobRepository: createDrizzleSupplierBookingJobRepository(db),
        enqueueSupplierBooking: enqueueSupplierBookingJob,
      });

      if (result.kind === "needs_user_input") return result.ui as UiIntent;
      if (result.kind !== "ok") return undefined;

      return {
        type: "text",
        body: "Booking started. I’ll update you shortly.",
      };
    },
    async continueWithDefaultPassenger(input) {
      const result = await collectDefaultPassengerAndQueueSupplierBooking({
        userId: input.userId,
        conversationId: input.conversationId,
        repository,
        jobRepository: createDrizzleSupplierBookingJobRepository(db),
        enqueueSupplierBooking: enqueueSupplierBookingJob,
      });

      if (result.kind === "needs_user_input") return result.ui as UiIntent;
      if (result.kind !== "ok") return { type: "text", body: "I could not start that booking yet. Please enter passenger details again." };

      return {
        type: "text",
        body: "Booking started. I’ll update you shortly.",
      };
    },
    async requestPassengerDetails(input) {
      const booking = await repository.findActiveBookingForPassengerCollection({
        userId: input.userId,
        conversationId: input.conversationId,
      });
      if (!booking) {
        return { type: "text", body: "I could not find an active booking to update. Please choose the flight again." };
      }

      return passengerDetailsFlowIntent({
        bookingId: booking.id,
        selectedFlightOptionId: booking.selectedFlightOptionId,
        body: "No problem. Enter the passenger details for this booking.",
        passengerDetailsFlowId,
      });
    },
  };
}

function passengerDetailsFlowIntent(input: {
  bookingId: string;
  selectedFlightOptionId: string;
  body: string;
  passengerDetailsFlowId: string;
}): UiIntent {
  return {
    type: "passenger_details_flow",
    body: input.body,
    buttonText: "Enter details",
    flowId: input.passengerDetailsFlowId,
    flowToken: input.bookingId,
    data: {
      bookingId: input.bookingId,
      selectedFlightOptionId: input.selectedFlightOptionId,
    },
  };
}

async function findBookingSummaryForSelectedFlight(selectedFlightOptionId: string): Promise<BookingSummaryDetails | undefined> {
  const result = await db.execute(sql`
    select
      origin,
      destination,
      airline_name,
      departure_at,
      amount,
      fare_rules
    from skypadi_whatsapp.flight_options
    where id = ${selectedFlightOptionId}
    limit 1
  `);
  const row = result.rows[0] as
    | {
        origin: string;
        destination: string;
        airline_name: string | null;
        departure_at: Date | string;
        amount: string | number;
        fare_rules?: Record<string, unknown> | null;
      }
    | undefined;
  if (!row) return undefined;

  return {
    route: `${row.origin} → ${row.destination}`,
    flight: `${row.airline_name ?? "Selected airline"}, ${formatFlightSummaryTime(row.departure_at)}`,
    baggage: row.fare_rules?.baggageIncluded === false
      ? "check baggage before paying"
      : "standard cabin + checked baggage included",
    fare: Number(row.amount),
    currency: "NGN",
    skypadiFee: 3000,
  };
}

function formatFlightSummaryTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: env.WAKANOW_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
