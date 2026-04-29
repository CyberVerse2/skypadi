import { env } from "./config.js";
import { buildServer } from "./app.js";

const server = buildServer();

const start = async () => {
  try {
    await server.listen({
      host: env.HOST,
      port: env.PORT
    });

    if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_VERIFY_TOKEN) {
      console.log("WhatsApp webhook is enabled at /webhooks/whatsapp");
    } else {
      console.log("WhatsApp webhook disabled until WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN are set");
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
