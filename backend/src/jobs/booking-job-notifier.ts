import { sql } from "drizzle-orm";

import type { WhatsAppClient } from "../channels/whatsapp/whatsapp.client";
import type { WhatsAppMessageRepository } from "../domain/conversation/conversation.types";
import type { DbClient } from "../db/client";
import type { SupplierHoldDecision } from "../workflows/supplier-booking.workflow";

export type SupplierBookingRecipient = {
  conversationId: string;
  phoneNumber: string;
};

export type SupplierDecisionNotifyResult =
  | { ok: true }
  | {
      ok: false;
      errorMessage: string;
    };

export function supplierDecisionMessage(decision: SupplierHoldDecision): string {
  if (decision.status === "awaiting_payment_for_hold") {
    const ref = decision.supplierBookingRef ? ` Ref: ${decision.supplierBookingRef}.` : "";
    const expiry = decision.holdExpiresAt
      ? ` Please pay before ${decision.holdExpiresAt.toLocaleTimeString("en-NG", {
          timeZone: "Africa/Lagos",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).toUpperCase()}.`
      : " Please pay before the hold expires.";
    const bankDetails = bankTransferText(decision);
    return bankDetails
      ? `Booking saved.${ref}\n\nPay ${formatMoney(decision.amountDue, decision.currency)} to:\n${bankDetails}\n${expiry.trim()}`
      : `Hold created.${ref}${expiry}`;
  }

  if (decision.status === "payment_pending") {
    return "This fare needs payment before ticketing. I saved the booking.";
  }

  return "I could not finish this automatically. I moved it to manual review.";
}

function bankTransferText(decision: SupplierHoldDecision): string | undefined {
  const bankTransfer = decision.bankTransfers?.[0];
  if (!bankTransfer) return undefined;
  return [
    bankTransfer.bank,
    bankTransfer.accountNumber,
    bankTransfer.beneficiary,
  ].filter(Boolean).join("\n");
}

function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (!amount) return currency ?? "the fare";
  if (currency === "NGN" || !currency) {
    return `NGN ${amount.toLocaleString("en-NG")}`;
  }
  return `${currency} ${amount.toLocaleString("en-NG")}`;
}

export async function findSupplierBookingRecipient(input: {
  db: DbClient;
  bookingId: string;
}): Promise<SupplierBookingRecipient | undefined> {
  const result = await input.db.execute(sql`
    select c.id as conversation_id, wc.phone_number
    from skypadi_whatsapp.bookings b
    inner join skypadi_whatsapp.conversations c on c.id = b.conversation_id
    inner join skypadi_whatsapp.whatsapp_contacts wc on wc.id = c.whatsapp_contact_id
    where b.id = ${input.bookingId}
    limit 1
  `);
  const row = result.rows[0] as { conversation_id: string; phone_number: string } | undefined;
  if (!row?.conversation_id || !row.phone_number) return undefined;
  return {
    conversationId: row.conversation_id,
    phoneNumber: row.phone_number,
  };
}

export async function notifySupplierDecision(input: {
  decision: SupplierHoldDecision;
  recipient: SupplierBookingRecipient;
  whatsappClient: WhatsAppClient;
  messageRepository?: Pick<WhatsAppMessageRepository, "recordOutboundMessage">;
  sentAt?: Date;
}): Promise<SupplierDecisionNotifyResult> {
  const body = supplierDecisionMessage(input.decision);
  const message = {
    type: "text" as const,
    text: { body },
  };

  try {
    await input.whatsappClient.sendMessage({
      to: input.recipient.phoneNumber,
      message,
    });
    await input.messageRepository?.recordOutboundMessage?.({
      conversationId: input.recipient.conversationId,
      textBody: body,
      payload: message,
      sentAt: input.sentAt ?? new Date(),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "WhatsApp supplier decision notification failed",
    };
  }
}
