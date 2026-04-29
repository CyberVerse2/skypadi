import { randomUUID } from "node:crypto";

import type { PaymentAttempt, PaymentMethod, TrustedPaymentConfirmationSource } from "./payment.types.js";
import type { PaymentRepository, PaymentWorkflowDecision } from "./payment.repository.js";

export type StartPaymentInput = {
  bookingId: string;
  amount: number;
  currency: "NGN";
  method: PaymentMethod;
  now?: Date;
  idGenerator?: () => string;
  repository?: PaymentRepository;
};

export function createPaymentDecision(input: {
  bookingId: string;
  paymentAttemptId: string;
  method?: PaymentMethod;
  paymentStatus: PaymentWorkflowDecision["paymentStatus"];
  bookingStatus: PaymentWorkflowDecision["bookingStatus"];
}): PaymentWorkflowDecision {
  return {
    bookingId: input.bookingId,
    paymentAttemptId: input.paymentAttemptId,
    method: input.method,
    paymentStatus: input.paymentStatus,
    bookingStatus: input.bookingStatus,
  };
}

export async function createTransferPaymentAttempt(input: StartPaymentInput): Promise<PaymentAttempt> {
  if (!input.repository) {
    throw new Error("payment repository dependency is required");
  }

  return input.repository.createPaymentAttempt({
    id: input.idGenerator?.() ?? randomUUID(),
    bookingId: input.bookingId,
    method: "transfer",
    amount: input.amount,
    currency: input.currency,
    createdAt: input.now ?? new Date(),
  });
}

export function assertTrustedConfirmationSource(source: string): asserts source is TrustedPaymentConfirmationSource {
  if (source !== "bank_transfer_reconciliation" && source !== "admin") {
    throw new Error("Payment confirmation requires a trusted source");
  }
}
