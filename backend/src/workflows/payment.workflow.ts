import { getCardPaymentProviderStatus } from "../integrations/payments/card.js";
import {
  assertTrustedConfirmationSource,
  createPaymentDecision,
  createTransferPaymentAttempt,
  type StartPaymentInput,
} from "../domain/payment/payment.service.js";
import type { PaymentRepository, PaymentWorkflowDecision } from "../domain/payment/payment.repository.js";
import { makeOk, type WorkflowResult } from "./workflow-result.js";

export async function startPayment(input: StartPaymentInput): Promise<WorkflowResult<PaymentWorkflowDecision>> {
  if (input.method === "card") {
    const provider = getCardPaymentProviderStatus();
    if (!provider.configured) {
      return { kind: "needs_manual_review", reason: "card payment provider is not configured" };
    }
  }

  if (input.method === "transfer") {
    return persistTransferPayment(input);
  }

  return { kind: "needs_manual_review", reason: "unsupported payment method" };
}

export async function persistTransferPayment(input: StartPaymentInput): Promise<WorkflowResult<PaymentWorkflowDecision>> {
  try {
    const attempt = await createTransferPaymentAttempt(input);
    return makeOk(
      createPaymentDecision({
        bookingId: attempt.bookingId,
        paymentAttemptId: attempt.id,
        method: attempt.method,
        paymentStatus: attempt.status,
        bookingStatus: "payment_pending",
      })
    );
  } catch (error) {
    return {
      kind: "temporary_failure",
      reason: error instanceof Error ? error.message : "Could not create transfer payment attempt",
    };
  }
}

export function handlePaidClaim(input: {
  bookingId: string;
  paymentAttemptId: string;
  claimedAt: Date;
}): PaymentWorkflowDecision {
  void input.claimedAt;
  return createPaymentDecision({
    bookingId: input.bookingId,
    paymentAttemptId: input.paymentAttemptId,
    method: "transfer",
    paymentStatus: "proof_uploaded",
    bookingStatus: "payment_pending",
  });
}

export async function persistPaidClaim(input: {
  bookingId: string;
  paymentAttemptId: string;
  claimedAt: Date;
  repository: PaymentRepository;
}): Promise<WorkflowResult<PaymentWorkflowDecision>> {
  await input.repository.markPaidClaimed(input);
  return makeOk(handlePaidClaim(input));
}

export function confirmPayment(input: {
  bookingId: string;
  paymentAttemptId: string;
  confirmedBy: string;
  confirmedAt: Date;
  providerReference: string;
  paidAmount: number;
  currency: "NGN";
}): PaymentWorkflowDecision {
  assertTrustedConfirmationSource(input.confirmedBy);
  if (!input.providerReference.trim()) {
    throw new Error("Payment confirmation requires a provider reference");
  }
  if (!Number.isFinite(input.paidAmount) || input.paidAmount <= 0) {
    throw new Error("Payment confirmation requires a positive paid amount");
  }
  void input.confirmedAt;
  return createPaymentDecision({
    bookingId: input.bookingId,
    paymentAttemptId: input.paymentAttemptId,
    method: "transfer",
    paymentStatus: "confirmed",
    bookingStatus: "payment_confirmed",
  });
}

export async function persistPaymentConfirmation(input: {
  bookingId: string;
  paymentAttemptId: string;
  confirmedBy: string;
  confirmedAt: Date;
  providerReference: string;
  paidAmount: number;
  currency: "NGN";
  repository: PaymentRepository;
}): Promise<WorkflowResult<PaymentWorkflowDecision>> {
  try {
    const decision = confirmPayment(input);
    await input.repository.confirmPayment(input);
    return makeOk(decision);
  } catch (error) {
    return {
      kind: "temporary_failure",
      reason: error instanceof Error ? error.message : "Could not confirm payment",
    };
  }
}
