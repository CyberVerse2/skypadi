export type TripType = "one_way" | "return";
export type ConversationExpectedField = "origin" | "trip_type" | "passengers" | "return_date" | "passenger_count";

export type ConversationDraft = {
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  departureWindow?: string;
  tripType?: TripType;
  adults?: number;
  expectedField?: ConversationExpectedField;
};

export type ConversationRecord = {
  id: string;
  userId?: string;
  phoneNumber: string;
  draft: ConversationDraft;
  updatedAt: Date;
};

export type ConversationRepository = {
  findByPhoneNumber(phoneNumber: string): Promise<ConversationRecord | undefined>;
  save(conversation: ConversationRecord): Promise<ConversationRecord>;
};

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
