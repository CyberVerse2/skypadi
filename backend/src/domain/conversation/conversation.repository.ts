import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import type { DbClient } from "../../db/client.js";
import type { ConversationRecord, ConversationRepository } from "./conversation.service.js";

export type WhatsAppMessageRepository = {
  recordInboundMessage(input: {
    phoneNumber: string;
    conversationId: string;
    providerMessageId: string;
    textBody?: string;
    payload: Record<string, unknown>;
    receivedAt: Date;
  }): Promise<{ wasCreated: boolean }>;
};

export function createDrizzleConversationRepository(db: DbClient): ConversationRepository & WhatsAppMessageRepository {
  return {
    async findByPhoneNumber(phoneNumber) {
      const result = await db.execute(sql`
        select c.id, wc.phone_number, c.metadata, c.updated_at
        from skypadi_whatsapp.conversations c
        inner join skypadi_whatsapp.whatsapp_contacts wc on wc.id = c.whatsapp_contact_id
        where wc.phone_number = ${phoneNumber}
        order by c.updated_at desc
        limit 1
      `);
      const row = result.rows[0] as
        | { id: string; phone_number: string; metadata: unknown; updated_at: Date | string }
        | undefined;
      if (!row) return undefined;
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const draft = isRecord(metadata.draft) ? metadata.draft : {};

      return {
        id: row.id,
        phoneNumber: row.phone_number,
        draft,
        updatedAt: new Date(row.updated_at),
      } as ConversationRecord;
    },
    async save(conversation) {
      const userId = randomUUID();
      const contactId = randomUUID();
      const conversationId = isUuid(conversation.id) ? conversation.id : randomUUID();

      await db.execute(sql`
        with user_row as (
          insert into skypadi_whatsapp.users (id, last_seen_at, created_at, updated_at)
          values (${userId}, ${conversation.updatedAt}, ${conversation.updatedAt}, ${conversation.updatedAt})
          on conflict do nothing
          returning id
        ),
        existing_contact as (
          select id, user_id from skypadi_whatsapp.whatsapp_contacts where phone_number = ${conversation.phoneNumber}
        ),
        contact_row as (
          insert into skypadi_whatsapp.whatsapp_contacts (id, user_id, phone_number, created_at, updated_at)
          select ${contactId}, coalesce((select id from user_row), ${userId}), ${conversation.phoneNumber}, ${conversation.updatedAt}, ${conversation.updatedAt}
          where not exists (select 1 from existing_contact)
          returning id, user_id
        ),
        resolved_contact as (
          select id, user_id from contact_row
          union all
          select id, user_id from existing_contact
          limit 1
        )
        insert into skypadi_whatsapp.conversations (
          id,
          user_id,
          whatsapp_contact_id,
          status,
          last_message_at,
          metadata,
          created_at,
          updated_at
        )
        select
          ${conversationId},
          resolved_contact.user_id,
          resolved_contact.id,
          'collecting_trip_details',
          ${conversation.updatedAt},
          ${JSON.stringify({ draft: conversation.draft })}::jsonb,
          ${conversation.updatedAt},
          ${conversation.updatedAt}
        from resolved_contact
        on conflict (id) do update
          set metadata = excluded.metadata,
              updated_at = excluded.updated_at,
              last_message_at = excluded.last_message_at
      `);

      return { ...conversation, id: conversationId, draft: { ...conversation.draft } };
    },
    async recordInboundMessage(input) {
      const result = await db.execute(sql`
        insert into skypadi_whatsapp.conversation_messages (
          conversation_id,
          direction,
          provider_message_id,
          text_body,
          payload,
          received_at
        )
        values (
          ${input.conversationId},
          'inbound',
          ${input.providerMessageId},
          ${input.textBody},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.receivedAt}
        )
        on conflict (provider_message_id) do nothing
        returning id
      `);
      return { wasCreated: result.rows.length > 0 };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
