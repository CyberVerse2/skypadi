export type WakanowSupplier = "wakanow";

export type SupplierHoldResult =
  | {
      kind: "hold_created";
      supplier: WakanowSupplier;
      supplierBookingRef: string;
      expiresAt: Date;
      amountDue: number;
      currency: "NGN";
      paymentUrl?: string;
      rawStatus: string;
    }
  | {
      kind: "instant_purchase_required";
      supplier: WakanowSupplier;
      reason: string;
      amountDue: number;
      currency: "NGN";
      rawStatus: string;
    }
  | {
      kind: "hold_unavailable";
      supplier: WakanowSupplier;
      reason: string;
      amountDue?: number;
      currency?: "NGN";
      rawStatus: string;
    }
  | {
      kind: "unclear";
      supplier: WakanowSupplier;
      reason: string;
      rawStatus: string;
    };

export type SupplierBookingPolicy = "hold_first" | "payment_first" | "manual_review";
