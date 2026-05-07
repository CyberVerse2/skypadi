
import {
  findSupplierBookingRecipient,
  notifySupplierDecision,
  supplierDecisionMessage,
} from "../../src/jobs/booking-job-notifier";
import type { DbClient } from "../../src/db/client";
import { describe, expect, test } from "vitest";


describe("unit booking job notifier", () => {
  test("booking job notifier", async () => {
    expect.hasAssertions();
    expect(supplierDecisionMessage({
        bookingId: "booking-1",
        status: "awaiting_payment_for_hold",
        policy: "hold_first",
        supplier: "wakanow",
        supplierBookingRef: "WK123",
        holdExpiresAt: new Date("2026-05-01T16:00:00.000Z"),
        amountDue: 120000,
        currency: "NGN",
        holdMode: "hold_created",
        rawStatus: "hold_created",
      })).toBe("Hold created. Ref: WK123. Please pay before 5:00 PM.");

    expect(supplierDecisionMessage({
        bookingId: "booking-1",
        status: "awaiting_payment_for_hold",
        policy: "hold_first",
        supplier: "wakanow",
        supplierBookingRef: "WK123",
        holdExpiresAt: new Date("2026-05-01T16:00:00.000Z"),
        amountDue: 120000,
        currency: "NGN",
        bankTransfers: [{
          bank: "Providus Bank",
          accountNumber: "1234567890",
          beneficiary: "Wakanow.com Collections",
          expiresIn: "9 hours",
          note: "Booking payment",
        }],
        holdMode: "hold_created",
        rawStatus: "hold_created",
      })).toBe([
        "Booking saved. Ref: WK123.",
        "",
        "Pay NGN 120,000 to:",
        "Providus Bank",
        "1234567890",
        "Wakanow.com Collections",
        "Please pay before 5:00 PM.",
      ].join("\n"));

    expect(supplierDecisionMessage({
        bookingId: "booking-1",
        status: "payment_pending",
        policy: "payment_first",
        supplier: "wakanow",
        amountDue: 120000,
        currency: "NGN",
        holdMode: "instant_purchase_required",
        rawStatus: "instant_purchase_required",
      })).toBe("This fare needs payment before ticketing. I saved the booking.");

    expect(supplierDecisionMessage({
        bookingId: "booking-1",
        status: "manual_review_required",
        policy: "manual_review",
        supplier: "wakanow",
        holdMode: "unclear",
        rawStatus: "unclear",
        reason: "browser timeout",
      })).toBe("I could not finish this automatically. I moved it to manual review.");

    const recipientQueries: unknown[] = [];
    const recipient = await findSupplierBookingRecipient({
      db: {
        async execute(query: unknown) {
          recipientQueries.push(query);
          return {
            rows: [
              {
                conversation_id: "11111111-1111-4111-8111-111111111111",
                phone_number: "2348012345678",
              },
            ],
          };
        },
      } as unknown as DbClient,
      bookingId: "booking-1",
    });

    expect(recipient).toEqual({
      conversationId: "11111111-1111-4111-8111-111111111111",
      phoneNumber: "2348012345678",
    });
    if (!recipient) {
      throw new Error("Expected supplier booking recipient");
    }
    expect(recipientQueries.length).toBe(1);

    const sentMessages: unknown[] = [];
    const outboundRecords: unknown[] = [];
    const notifyResult = await notifySupplierDecision({
      decision: {
        bookingId: "booking-1",
        status: "payment_pending",
        policy: "payment_first",
        supplier: "wakanow",
        amountDue: 120000,
        currency: "NGN",
        holdMode: "instant_purchase_required",
        rawStatus: "instant_purchase_required",
      },
      recipient,
      whatsappClient: {
        async sendMessage(input) {
          sentMessages.push(input);
        },
        async markMessageRead() {},
        async showTypingIndicator() {},
      },
      messageRepository: {
        async recordOutboundMessage(input) {
          outboundRecords.push(input);
        },
      },
    });

    expect(notifyResult).toEqual({ ok: true });
    expect(sentMessages).toEqual([
      {
        to: "2348012345678",
        message: {
          type: "text",
          text: { body: "This fare needs payment before ticketing. I saved the booking." },
        },
      },
    ]);
    expect(outboundRecords).toEqual([
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        textBody: "This fare needs payment before ticketing. I saved the booking.",
        payload: {
          type: "text",
          text: { body: "This fare needs payment before ticketing. I saved the booking." },
        },
        sentAt: (outboundRecords[0] as { sentAt: Date }).sentAt,
      },
    ]);

    const failedNotify = await notifySupplierDecision({
      decision: {
        bookingId: "booking-1",
        status: "manual_review_required",
        policy: "manual_review",
        supplier: "wakanow",
        holdMode: "unclear",
        rawStatus: "unclear",
        reason: "browser timeout",
      },
      recipient,
      whatsappClient: {
        async sendMessage() {
          throw new Error("WhatsApp unavailable");
        },
        async markMessageRead() {},
        async showTypingIndicator() {},
      },
      messageRepository: {
        async recordOutboundMessage() {
          throw new Error("should not record after failed send");
        },
      },
    });

    expect(failedNotify.ok).toBe(false);
    if (!failedNotify.ok) {
      expect(failedNotify.errorMessage).toBe("WhatsApp unavailable");
    }
  });
});
