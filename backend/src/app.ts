import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { env } from "./config.js";
import { flightSearchRequestSchema } from "./schemas/flight-search.js";
import { WakanowApiSearchError, searchFlightsApi } from "./integrations/wakanow/api-search.js";
import { registerWhatsAppRoutes } from "./channels/whatsapp/index.js";
import { registerResendWebhookRoutes } from "./integrations/resend/webhook.routes.js";

export type BuildServerOptions = {
  whatsappVerifyToken?: string;
  resendWebhookSecret?: string;
};

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: true });
  app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true
  });
  registerWhatsAppRoutes(app);
  const resendWebhookSecret = options.resendWebhookSecret ?? env.RESEND_WEBHOOK_SECRET;
  if (resendWebhookSecret) {
    registerResendWebhookRoutes(app, { webhookSecret: resendWebhookSecret });
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
