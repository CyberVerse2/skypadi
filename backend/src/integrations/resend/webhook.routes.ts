import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../db/client.js";
import { createDrizzleInboundEmailRepository } from "../../domain/inbound-email/inbound-email.repository.js";
import { handleInboundEmail } from "../../workflows/inbound-email.workflow.js";
import { verifyResendWebhook } from "./resend.webhook-verifier.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string | Buffer };

export type ResendWebhookRouteOptions = {
  webhookSecret: string;
  repository?: ReturnType<typeof createDrizzleInboundEmailRepository>;
};

export function registerResendWebhookRoutes(app: FastifyInstance, options: ResendWebhookRouteOptions) {
  app.post(
    "/webhooks/resend",
    {
      config: { rawBody: true }
    },
    (request, reply) => handleResendWebhook(request as RawBodyRequest, reply, options)
  );
}

async function handleResendWebhook(request: RawBodyRequest, reply: FastifyReply, options: ResendWebhookRouteOptions) {
  try {
    const payload = rawPayload(request);
    const event = verifyResendWebhook({
      payload,
      webhookSecret: options.webhookSecret,
      headers: {
        id: headerValue(request.headers["svix-id"]),
        timestamp: headerValue(request.headers["svix-timestamp"]),
        signature: headerValue(request.headers["svix-signature"])
      }
    });

    if (event.type !== "email.received") {
      return reply.send({ ok: true, ignored: event.type });
    }

    const data = event.data as {
      email_id: string;
      from?: string;
      to?: string[];
      subject?: string;
      text?: string;
      html?: string;
      created_at?: string;
      message_id?: string;
    };
    const result = await handleInboundEmail({
      resendEmailId: data.email_id,
      messageId: data.message_id,
      to: data.to ?? [],
      from: data.from ?? "",
      subject: data.subject ?? "",
      text: data.text,
      html: data.html,
      receivedAt: data.created_at ? new Date(data.created_at) : new Date(),
      repository: options.repository ?? createDrizzleInboundEmailRepository(db),
      raw: data
    });

    request.log.info({ result }, "Processed Resend inbound email");
    return reply.send({ ok: true, result });
  } catch (error) {
    request.log.error({ err: error }, "Resend webhook failed");
    return reply.status(400).send({ ok: false, error: "invalid_resend_webhook" });
  }
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
