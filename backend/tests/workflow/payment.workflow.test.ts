import assert from "node:assert/strict";

import {
  confirmPayment,
  handlePaidClaim,
  persistPaidClaim,
  persistPaymentConfirmation,
  startPayment,
} from "../../src/workflows/payment.workflow.js";
import type { PaymentRepository, PaymentConfirmationRecord } from "../../src/domain/payment/payment.repository.js";

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

assert.equal(transfer.kind, "ok");
if (transfer.kind === "ok") {
  assert.equal(transfer.value.paymentStatus, "pending");
  assert.equal(transfer.value.bookingStatus, "payment_pending");
  assert.equal(transfer.value.method, "transfer");
}
assert.equal(createdAttempts.length, 1);

const card = await startPayment({
  bookingId: "book_123",
  amount: 161000,
  currency: "NGN",
  method: "card",
});

assert.equal(card.kind, "needs_manual_review");

const paidClaim = handlePaidClaim({
  bookingId: "book_123",
  paymentAttemptId: "pay_123",
  claimedAt: new Date("2026-04-29T10:00:00.000Z"),
});

assert.equal(paidClaim.paymentStatus, "proof_uploaded");
assert.equal(paidClaim.bookingStatus, "payment_pending");

const persistedPaidClaim = await persistPaidClaim({
  bookingId: "book_123",
  paymentAttemptId: "pay_123",
  claimedAt: new Date("2026-04-29T10:00:00.000Z"),
  repository,
});

assert.equal(persistedPaidClaim.kind, "ok");
assert.equal(paidClaims.length, 1);

const confirmed = confirmPayment({
  bookingId: "book_123",
  paymentAttemptId: "pay_123",
  confirmedBy: "bank_transfer_reconciliation",
  confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
  providerReference: "bank_tx_123",
  paidAmount: 161000,
  currency: "NGN",
});

assert.equal(confirmed.paymentStatus, "confirmed");
assert.equal(confirmed.bookingStatus, "payment_confirmed");

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

assert.equal(persistedConfirmation.kind, "ok");
assert.equal(confirmations.length, 1);
assert.equal(confirmations[0]?.providerReference, "bank_tx_123");
assert.equal(confirmations[0]?.paidAmount, 161000);

assert.throws(
  () =>
    confirmPayment({
      bookingId: "book_123",
      paymentAttemptId: "pay_123",
      confirmedBy: "customer_message",
      confirmedAt: new Date("2026-04-29T10:03:00.000Z"),
      providerReference: "bank_tx_123",
      paidAmount: 161000,
      currency: "NGN",
    }),
  /trusted source/
);
console.log("payment workflow tests passed");
