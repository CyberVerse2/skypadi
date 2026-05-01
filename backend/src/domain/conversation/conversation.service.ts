import type { ConversationRecord, ConversationRepository } from "./conversation.types";

export function createConversationRecord(phoneNumber: string, now: Date): ConversationRecord {
  return {
    id: `conversation:${phoneNumber}`,
    phoneNumber,
    draft: {},
    updatedAt: now,
  };
}

export async function findOrCreateConversation(
  repository: ConversationRepository,
  phoneNumber: string,
  now: Date
): Promise<ConversationRecord> {
  return (await repository.findByPhoneNumber(phoneNumber)) ?? createConversationRecord(phoneNumber, now);
}
