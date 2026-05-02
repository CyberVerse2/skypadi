
import { normalizeWakanowHoldStatus } from "../../src/integrations/wakanow/wakanow.booking";
import { handleSupplierHoldResult, recordSupplierHoldDecision } from "../../src/workflows/supplier-booking.workflow";
import { describe, expect, test } from "vitest";


describe("workflow supplier booking workflow", () => {
  test("supplier booking workflow", async () => {
    expect.hasAssertions();
    const hold = handleSupplierHoldResult({
      bookingId: "book_123",
      result: {
        kind: "hold_created",
        supplier: "wakanow",
        supplierBookingRef: "WK123",
        expiresAt: new Date("2026-04-29T18:00:00.000Z"),
        amountDue: 161000,
        currency: "NGN",
        paymentUrl: "https://pay.example/wk123",
        bankTransfers: [{
          bank: "Providus Bank",
          accountNumber: "1234567890",
          beneficiary: "Wakanow.com Collections",
          expiresIn: "9 hours",
          note: "Booking payment",
        }],
        rawStatus: "Active",
      },
    });

    expect(hold.status).toBe("awaiting_payment_for_hold");
    expect(hold.supplierBookingRef).toBe("WK123");
    expect(hold.policy).toBe("hold_first");
    expect(hold.holdMode).toBe("hold_created");
    expect(hold.paymentUrl).toBe("https://pay.example/wk123");
    expect(hold.bankTransfers?.[0]?.accountNumber).toBe("1234567890");

    const normalized = normalizeWakanowHoldStatus({
      status: "Active",
      supplierBookingRef: "WK124",
      expiresAt: "2026-04-29T18:00:00.000Z",
      amountDue: 161000,
    });
    expect(normalized.kind).toBe("hold_created");
    if (normalized.kind === "hold_created") {
      expect(normalized.expiresAt.toISOString()).toBe("2026-04-29T18:00:00.000Z");
    }

    const missingAmount = normalizeWakanowHoldStatus({
      status: "InstantPurchase",
    });
    expect(missingAmount.kind).toBe("unclear");

    const instant = handleSupplierHoldResult({
      bookingId: "book_456",
      result: {
        kind: "instant_purchase_required",
        supplier: "wakanow",
        reason: "Travel date is less than one week away",
        amountDue: 161000,
        currency: "NGN",
        rawStatus: "InstantPurchase",
      },
    });

    expect(instant.status).toBe("payment_pending");
    expect(instant.policy).toBe("payment_first");

    const unavailable = handleSupplierHoldResult({
      bookingId: "book_789",
      result: {
        kind: "hold_unavailable",
        supplier: "wakanow",
        reason: "Supplier did not offer a hold",
        rawStatus: "HoldUnavailable",
      },
    });

    expect(unavailable.status).toBe("payment_pending");
    expect(unavailable.policy).toBe("payment_first");
    expect(unavailable.amountDue).toBe(undefined);

    const unclear = handleSupplierHoldResult({
      bookingId: "book_unclear",
      result: {
        kind: "unclear",
        supplier: "wakanow",
        reason: "Unexpected response",
        rawStatus: "???",
      },
    });

    expect(unclear.status).toBe("manual_review_required");
    expect(unclear.policy).toBe("manual_review");

    const applied: unknown[] = [];
    await recordSupplierHoldDecision({
      decision: hold,
      repository: {
        async applySupplierDecision(input) {
          applied.push(input);
        },
      },
      observedAt: new Date("2026-04-29T09:05:00.000Z"),
    });
    expect(applied.length).toBe(1);
    expect(applied[0]).toEqual({
      bookingId: "book_123",
      status: "awaiting_payment_for_hold",
      supplier: "wakanow",
      supplierBookingRef: "WK123",
      holdExpiresAt: new Date("2026-04-29T18:00:00.000Z"),
      amountDue: 161000,
      currency: "NGN",
      supplierPaymentInstructions: [{
        bank: "Providus Bank",
        accountNumber: "1234567890",
        beneficiary: "Wakanow.com Collections",
        expiresIn: "9 hours",
        note: "Booking payment",
      }],
      failureReason: undefined,
      eventType: "supplier_hold.hold_created",
      eventPayload: {
        status: "awaiting_payment_for_hold",
        policy: "hold_first",
        holdMode: "hold_created",
        supplierBookingRef: "WK123",
        holdExpiresAt: "2026-04-29T18:00:00.000Z",
        amountDue: 161000,
        currency: "NGN",
        paymentUrl: "https://pay.example/wk123",
        bankTransfers: [{
          bank: "Providus Bank",
          accountNumber: "1234567890",
          beneficiary: "Wakanow.com Collections",
          expiresIn: "9 hours",
          note: "Booking payment",
        }],
        reason: undefined,
        rawStatus: "Active",
      },
      observedAt: new Date("2026-04-29T09:05:00.000Z"),
    });
  });
});
