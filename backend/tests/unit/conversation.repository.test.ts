import assert from "node:assert/strict";

import { createDrizzleConversationRepository } from "../../src/domain/conversation/conversation.repository";
import type { DbClient } from "../../src/db/client";

const executedQueries: unknown[] = [];
const db = {
  async execute(query: unknown) {
    executedQueries.push(query);
    return { rows: [{ id: "message-1" }] };
  },
} as unknown as DbClient;

const repository = createDrizzleConversationRepository(db);

await repository.recordInboundMessage({
  phoneNumber: "2348012345678",
  conversationId: "11111111-1111-4111-8111-111111111111",
  providerMessageId: "wamid.interactive",
  payload: {
    id: "wamid.interactive",
    from: "2348012345678",
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: "trip_type:one_way" } },
  },
  receivedAt: new Date("2026-04-29T14:30:36.000Z"),
});

const queryChunks = (executedQueries[0] as { queryChunks?: unknown[] }).queryChunks ?? [];
assert.equal(queryChunks.includes(undefined), false);
assert.equal(queryChunks.includes(null), true);

await repository.recordOutboundMessage?.({
  conversationId: "11111111-1111-4111-8111-111111111111",
  textBody: "Where are you flying from?",
  payload: {
    type: "text",
    text: { body: "Where are you flying from?" },
  },
  sentAt: new Date("2026-04-29T14:31:00.000Z"),
});

const outboundQueryChunks = (executedQueries[1] as { queryChunks?: unknown[] }).queryChunks ?? [];
assert.equal(outboundQueryChunks.includes(undefined), false);
assert.equal(outboundQueryChunks.some((chunk) => sqlChunkText(chunk).includes("'outbound'")), true);

console.log("conversation repository tests passed");

function sqlChunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (!chunk || typeof chunk !== "object") return "";
  const value = (chunk as { value?: unknown }).value;
  if (Array.isArray(value)) return value.join("");
  return "";
}
