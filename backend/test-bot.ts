import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN env var");
  process.exit(1);
}
const bot = new Bot(token);

bot.on("message:text", (ctx) => {
  console.log("Got message:", ctx.message.text);
  return ctx.reply("Hello! I received: " + ctx.message.text);
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

console.log("Starting bot...");
bot.start({
  onStart: (info) => console.log(`Bot @${info.username} is running`),
});
