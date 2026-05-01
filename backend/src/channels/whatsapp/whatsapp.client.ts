import type { WhatsAppMessagePayload } from "./whatsapp.types";

export type WhatsAppClient = {
  sendMessage(input: {
    to: string;
    message: WhatsAppMessagePayload;
  }): Promise<void>;
  markMessageRead(input: {
    messageId: string;
  }): Promise<void>;
  showTypingIndicator(input: {
    messageId: string;
  }): Promise<void>;
};

export type WhatsAppCloudClientOptions = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
};

export function createWhatsAppCloudClient(options: WhatsAppCloudClientOptions): WhatsAppClient {
  const apiVersion = options.apiVersion ?? "v25.0";
  const messagesUrl = `https://graph.facebook.com/${apiVersion}/${options.phoneNumberId}/messages`;

  return {
    async sendMessage(input) {
      await postWhatsAppMessage({
        accessToken: options.accessToken,
        messagesUrl,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          ...input.message,
        },
        errorPrefix: "WhatsApp Cloud API send failed",
      });
    },
    async markMessageRead(input) {
      await postWhatsAppMessage({
        accessToken: options.accessToken,
        messagesUrl,
        body: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
        },
        errorPrefix: "WhatsApp Cloud API mark read failed",
      });
    },
    async showTypingIndicator(input) {
      await postWhatsAppMessage({
        accessToken: options.accessToken,
        messagesUrl,
        body: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
          typing_indicator: {
            type: "text",
          },
        },
        errorPrefix: "WhatsApp Cloud API typing indicator failed",
      });
    },
  };
}

async function postWhatsAppMessage(input: {
  accessToken: string;
  messagesUrl: string;
  body: Record<string, unknown>;
  errorPrefix: string;
}): Promise<void> {
  const response = await fetch(input.messagesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${input.errorPrefix}: ${response.status} ${body.slice(0, 300)}`);
  }
}
