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
