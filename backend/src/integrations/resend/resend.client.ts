import { Resend, type WebhookEventPayload } from "resend";

export type ResendClient = Resend;
export type ResendWebhookEvent = WebhookEventPayload;
export type ResendReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  createdAt: string;
  messageId?: string;
};

export function createResendClient(apiKey: string): ResendClient {
  return new Resend(apiKey);
}

export async function getReceivedEmail(client: ResendClient, emailId: string): Promise<ResendReceivedEmail> {
  const { data, error } = await client.emails.receiving.get(emailId);
  if (error) {
    throw new Error(`Resend received email fetch failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Resend received email fetch returned no data for ${emailId}`);
  }

  return {
    id: data.id,
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text ?? undefined,
    html: data.html ?? undefined,
    createdAt: data.created_at,
    messageId: data.message_id,
  };
}
