import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(root, relPath), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const botIndex = read("src/bot/index.ts");
  const botAi = read("src/bot/ai.ts");
  const apiBook = read("src/services/wakanow/api-book.ts");
  const db = read("src/db.ts");

  assert(
    !botIndex.includes("AgentMail"),
    "Telegram bot copy should not mention AgentMail"
  );

  assert(
    !botIndex.includes("sent a verification code to"),
    "Telegram bot copy should not claim a code was sent to the user's email"
  );

  assert(
    botAi.includes("Booking confirmation received"),
    "AI booking reply should use neutral confirmation wording"
  );

  assert(
    apiBook.includes("contactContext"),
    "Booking API should return internal contact context"
  );

  assert(
    db.includes("customer_email") && db.includes("booking_contact_email"),
    "DB persistence should store both customer and booking contact emails"
  );

  console.log("Bot booking contract checks passed.");
}

main();
