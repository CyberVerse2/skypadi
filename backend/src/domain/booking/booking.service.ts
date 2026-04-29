import { randomUUID } from "node:crypto";

import { generateBookingEmailAlias } from "../../integrations/resend/booking-alias.service.js";
import type { BookingDraft } from "./booking.types.js";
import type { BookingRepository } from "./booking.repository.js";

export type CreateBookingDraftInput = {
  userId: string;
  conversationId: string;
  selectedFlightOptionId: string;
  inboundDomain: string;
  now?: Date;
  idGenerator?: () => string;
  aliasTokenGenerator?: () => string;
  repository: BookingRepository;
};

export async function createPricedBookingDraft(input: CreateBookingDraftInput): Promise<BookingDraft> {
  const now = input.now ?? new Date();
  const bookingId = input.idGenerator?.() ?? randomUUID();
  const alias = generateBookingEmailAlias({
    domain: input.inboundDomain,
    prefix: "book",
    idGenerator: input.aliasTokenGenerator,
  });

  return input.repository.createDraft({
    id: bookingId,
    userId: input.userId,
    conversationId: input.conversationId,
    selectedFlightOptionId: input.selectedFlightOptionId,
    status: "priced",
    bookingEmailAlias: alias.emailAddress,
    aliasLocalPart: alias.localPart,
    aliasDomain: alias.domain,
    createdAt: now,
  });
}
