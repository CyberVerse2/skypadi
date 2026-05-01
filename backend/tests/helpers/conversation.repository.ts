import type { ConversationRecord, ConversationRepository } from "../../src/domain/conversation/conversation.types";

export function createInMemoryConversationRepository(): ConversationRepository {
  const conversations = new Map<string, ConversationRecord>();

  return {
    async findByPhoneNumber(phoneNumber) {
      const conversation = conversations.get(phoneNumber);
      return conversation
        ? {
            ...conversation,
            draft: { ...conversation.draft },
          }
        : undefined;
    },
    async save(conversation) {
      const saved = {
        ...conversation,
        draft: { ...conversation.draft },
      };
      conversations.set(conversation.phoneNumber, saved);
      return {
        ...saved,
        draft: { ...saved.draft },
      };
    },
  };
}
