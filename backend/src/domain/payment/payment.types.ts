import type { BookingStatus } from "../booking/booking.types";

export type PaymentStatus =
  | "pending"
  | "proof_uploaded"
  | "confirmed"
  | "failed"
  | "expired"
  | "refunded"
  | "manual_review_required";

export type PaymentMethod = "transfer" | "card";

export type PaymentAttempt = {
  id: string;
  bookingId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: "NGN";
  providerReference?: string;
  createdAt: Date;
};

export type TrustedPaymentConfirmationSource = "bank_transfer_reconciliation" | "admin";

export type CreatePaymentAttemptRecord = {
  id: string;
  bookingId: string;
  method: "transfer" | "card";
  amount: number;
  currency: "NGN";
  providerReference?: string;
  createdAt: Date;
};

export type PaymentConfirmationRecord = {
  bookingId: string;
  paymentAttemptId: string;
  confirmedBy: string;
  confirmedAt: Date;
  providerReference: string;
  paidAmount: number;
  currency: "NGN";
};

export type PaymentRepository = {
  createPaymentAttempt(input: CreatePaymentAttemptRecord): Promise<PaymentAttempt>;
  markPaidClaimed(input: { bookingId: string; paymentAttemptId: string; claimedAt: Date }): Promise<void>;
  confirmPayment(input: PaymentConfirmationRecord): Promise<void>;
};

export type PaymentWorkflowDecision = {
  bookingId: string;
  paymentAttemptId: string;
  method?: "transfer" | "card";
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
};

export type StartPaymentInput = {
  bookingId: string;
  amount: number;
  currency: "NGN";
  method: PaymentMethod;
  now?: Date;
  idGenerator?: () => string;
  repository?: PaymentRepository;
};
