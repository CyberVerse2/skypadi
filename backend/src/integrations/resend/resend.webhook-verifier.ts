import { Resend, type WebhookEventPayload } from "resend";

export type ResendWebhookHeaders = {
  id?: string;
  timestamp?: string;
  signature?: string;
};

export function verifyResendWebhook(input: {
  payload: string;
  headers: ResendWebhookHeaders;
  webhookSecret: string;
  resend?: Resend;
}): WebhookEventPayload {
  const resend = input.resend ?? new Resend("re_webhook_verification_only");

  if (!input.headers.id || !input.headers.timestamp || !input.headers.signature) {
    throw new Error("Missing Resend webhook signature headers");
  }

  return resend.webhooks.verify({
    payload: input.payload,
    headers: {
      id: input.headers.id,
      timestamp: input.headers.timestamp,
      signature: input.headers.signature,
    },
    webhookSecret: input.webhookSecret,
  });
}
