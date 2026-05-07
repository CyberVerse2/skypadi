
import {
  confirmPayment,
  handlePaidClaim,
  persistPaidClaim,
  persistPaymentConfirmation,
  startPayment,
} from "../../src/workflows/payment.workflow";
import type { PaymentRepository, PaymentConfirmationRecord } from "../../src/domain/payment/payment.types";
import { describe, expect, test } from "vitest";


describe("workflow payment workflow", () => {
  test("payment workflow", async () => {
    expect.hasAssertions();
    const createdAttempts: unknown[] = [];
    const paidClaims: unknown[] = [];
    const confirmations: PaymentConfirmationRecord[] = [];
    const repository: PaymentRepository = {
      async createPaymentAttempt(input) {
        createdAttempts.push(input);
        return {
          id: input.id,
          bookingId: input.bookingId,
          method: input.method,
          status: "pending",
          amount: input.amount,
          currency: input.currency,
          providerReference: input.providerReference,
          createdAt: input.createdAt,
        };
      },
      async markPaidClaimed(input) {
        paidClaims.push(input);
      },
      async confirmPayment(input) {
        confirmations.push(input);
      },
    };

    const transfer = await startPayment({
      bookingId: "book_123",
      amount: 161000,
      currency: "NGN",
      method: "transfer",
      now: new Date("2026-04-29T09:55:00.000Z"),
      idGenerator: () => "pay_123",
      repository,
    });

    expect(transfer.kind).toBe("ok");
    if (transfer.kind === "ok") {
      expect(transfer.value.paymentStatus).toBe("pending");
      expect(transfer.value.bookingStatus).toBe("payment_pending");
      expect(transfer.value.method).toBe("transfer");
    }
    expect(createdAttempts.length).toBe(1);

    const card = await startPayment({
      bookingId: "book_123",
      amount: 161000,
      currency: "NGN",
      method: "card",
    });

    expect(card.kind).toBe("needs_manual_review");

    const paidClaim = handlePaidClaim({
      bookingId: "book_123",
      paymentAttemptId: "pay_123",
      claimedAt: new Date("2026-04-29T10:00:00.000Z"),
    });

    expect(paidClaim.paymentStatus).toBe("proof_uploaded");
    expect(paidClaim.bookingStatus).toBe("payment_pending");

    const persistedPaidClaim = await persistPaidClaim({
      bookingId: "book_123",
      paymentAttemptId: "pay_123",
      claimedAt: new Date("2026-04-29T10:00:00.000Z"),
      repository,
    });

    expect(persistedPaidClaim.kind).toBe("ok");
    expect(paidClaims.length).toBe(1);

    const confirmed = confirmPayment({
      bookingId: "book_123",
      paymentAttemptId: "pay_123",
      confirmedBy: "bank_transfer_reconciliation",
      confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
      providerReference: "bank_tx_123",
      paidAmount: 161000,
      currency: "NGN",
    });

    expect(confirmed.paymentStatus).toBe("confirmed");
    expect(confirmed.bookingStatus).toBe("payment_confirmed");

    const persistedConfirmation = await persistPaymentConfirmation({
      bookingId: "book_123",
      paymentAttemptId: "pay_123",
      confirmedBy: "bank_transfer_reconciliation",
      confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
      providerReference: "bank_tx_123",
      paidAmount: 161000,
      currency: "NGN",
      repository,
    });

    expect(persistedConfirmation.kind).toBe("ok");
    expect(confirmations.length).toBe(1);
    expect(confirmations[0]?.providerReference).toBe("bank_tx_123");
    expect(confirmations[0]?.paidAmount).toBe(161000);

    expect(() =>
        confirmPayment({
          bookingId: "book_123",
          paymentAttemptId: "pay_123",
          confirmedBy: "customer_message",
          confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
          providerReference: "bank_tx_123",
          paidAmount: 161000,
          currency: "NGN",
        })).toThrow(/trusted source/);
  });
});
