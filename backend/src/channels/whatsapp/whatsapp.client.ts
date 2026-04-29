import type { WhatsAppMessagePayload } from "./whatsapp.types.js";

export type WhatsAppClient = {
  sendMessage(input: {
    to: string;
    message: WhatsAppMessagePayload;
  }): Promise<void>;
};

export type WhatsAppCloudClientOptions = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
};

export function createWhatsAppCloudClient(options: WhatsAppCloudClientOptions): WhatsAppClient {
  const apiVersion = options.apiVersion ?? "v20.0";

  return {
    async sendMessage(input) {
      const response = await fetch(`https://graph.facebook.com/${apiVersion}/${options.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          ...input.message,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`WhatsApp Cloud API send failed: ${response.status} ${body.slice(0, 300)}`);
      }
    },
  };
}
