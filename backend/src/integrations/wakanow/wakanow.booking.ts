import type { SupplierHoldResult } from "./wakanow.types.js";

export type WakanowHoldClient = {
  createHold(input: WakanowHoldRequest): Promise<SupplierHoldResult>;
};

export type WakanowHoldRequest = {
  bookingId: string;
  selectedFlightOptionId: string;
  passengerSnapshot: Record<string, unknown>;
  contactEmail: string;
};

export function normalizeWakanowHoldStatus(input: {
  status: string;
  supplierBookingRef?: string;
  expiresAt?: Date | string;
  amountDue?: number;
  currency?: "NGN";
  paymentUrl?: string;
  reason?: string;
}): SupplierHoldResult {
  const rawStatus = input.status;
  const normalized = rawStatus.trim().toLowerCase();

  if (normalized === "active" || normalized === "hold_created") {
    const expiresAt = parseSupplierDate(input.expiresAt);
    if (!input.supplierBookingRef || !expiresAt || !hasPositiveAmount(input.amountDue)) {
      return unclear(rawStatus, input.reason ?? "Supplier hold response was missing required booking details");
    }

    return {
      kind: "hold_created",
      supplier: "wakanow",
      supplierBookingRef: input.supplierBookingRef,
      expiresAt,
      amountDue: input.amountDue,
      currency: input.currency ?? "NGN",
      paymentUrl: input.paymentUrl,
      rawStatus,
    };
  }

  if (normalized === "instantpurchase" || normalized === "instant_purchase_required") {
    if (!hasPositiveAmount(input.amountDue)) {
      return unclear(rawStatus, input.reason ?? "Instant-purchase response was missing amount due");
    }

    return {
      kind: "instant_purchase_required",
      supplier: "wakanow",
      reason: input.reason ?? "Supplier requires instant purchase",
      amountDue: input.amountDue,
      currency: input.currency ?? "NGN",
      rawStatus,
    };
  }

  if (normalized === "holdunavailable" || normalized === "hold_unavailable") {
    return {
      kind: "hold_unavailable",
      supplier: "wakanow",
      reason: input.reason ?? "Supplier did not offer a hold",
      amountDue: input.amountDue,
      currency: input.currency,
      rawStatus,
    };
  }

  return unclear(rawStatus, input.reason ?? "Supplier hold status was not recognized");
}

function unclear(rawStatus: string, reason: string): SupplierHoldResult {
  return {
    kind: "unclear",
    supplier: "wakanow",
    reason,
    rawStatus,
  };
}

function parseSupplierDate(value: Date | string | undefined): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function hasPositiveAmount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
