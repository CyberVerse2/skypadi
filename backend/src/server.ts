import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./config.js";
import { flightBookingRequestSchema } from "./schemas/flight-booking.js";
import { flightSearchRequestSchema } from "./schemas/flight-search.js";
import { WakanowBookingError, bookWakanowFlight } from "./services/wakanow/book.js";
import { WakanowSearchError, searchWakanowFlights } from "./services/wakanow/search.js";
import { WakanowApiSearchError, searchFlightsApi } from "./services/wakanow/api-search.js";

export function buildServer() {
  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      provider: "wakanow",
      time: new Date().toISOString()
    };
  });

  app.post("/api/flights/search", async (request, reply) => {
    try {
      const payload = flightSearchRequestSchema.parse(request.body);
      const result = await searchFlightsApi(payload);
      return reply.send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: "invalid_request",
          issues: error.issues
        });
      }

      if (error instanceof WakanowApiSearchError || error instanceof WakanowSearchError) {
        request.log.warn({ err: error }, "Wakanow search failed");
        return reply.status(502).send({
          error: "wakanow_search_failed",
          message: error.message,
          details: error.details ?? null
        });
      }

      request.log.error({ err: error }, "Unexpected flight search failure");
      return reply.status(500).send({
        error: "internal_error",
        message: "Unexpected server error"
      });
    }
  });

  app.post("/api/flights/book", async (request, reply) => {
    try {
      const payload = flightBookingRequestSchema.parse(request.body);
      const result = await bookWakanowFlight(payload);
      return reply.send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: "invalid_request",
          issues: error.issues
        });
      }

      if (error instanceof WakanowBookingError) {
        request.log.warn({ err: error }, "Wakanow booking failed");
        return reply.status(502).send({
          error: "wakanow_booking_failed",
          message: error.message,
          details: error.details ?? null
        });
      }

      request.log.error({ err: error }, "Unexpected booking failure");
      return reply.status(500).send({
        error: "internal_error",
        message: "Unexpected server error"
      });
    }
  });

  app.get("/", async () => {
    return {
      name: "skypadi-backend",
      endpoints: ["/health", "/api/flights/search", "/api/flights/book"],
      defaults: {
        currency: env.WAKANOW_CURRENCY,
        timezone: env.WAKANOW_TIMEZONE
      }
    };
  });

  return app;
}
