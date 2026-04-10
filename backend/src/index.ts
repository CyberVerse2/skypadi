import { env } from "./config.js";
import { buildServer } from "./server.js";

const server = buildServer();

const start = async () => {
  try {
    await server.listen({
      host: env.HOST,
      port: env.PORT
    });

    if (env.TELEGRAM_BOT_TOKEN && env.OPENAI_API_KEY) {
      const { createBot } = await import("./bot/index.js");
      const bot = createBot();
      bot.catch((err) => {
        console.error("Bot error:", err);
      });
      bot.start({
        onStart: (info) => {
          console.log(`Telegram bot @${info.username} is running`);
        }
      }).catch((err) => {
        console.error("Bot polling failed:", err);
      });
    } else {
      console.log("TELEGRAM_BOT_TOKEN or OPENAI_API_KEY not set — bot disabled, API-only mode");
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
