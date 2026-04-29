import { Resend, type WebhookEventPayload } from "resend";

export type ResendClient = Resend;
export type ResendWebhookEvent = WebhookEventPayload;

export function createResendClient(apiKey: string): ResendClient {
  return new Resend(apiKey);
}
