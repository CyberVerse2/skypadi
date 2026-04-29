export type PaymentStatus =
  | "pending"
  | "proof_uploaded"
  | "confirmed"
  | "failed"
  | "expired"
  | "refunded"
  | "manual_review_required";

export type PaymentMethod = "transfer" | "card";
