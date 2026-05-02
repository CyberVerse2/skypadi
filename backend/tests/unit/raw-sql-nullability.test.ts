
import type { SQL } from "drizzle-orm";

import type { DbClient } from "../../src/db/client";
import { createDrizzleBookingRepository } from "../../src/domain/booking/booking.repository";
import { createDrizzleInboundEmailRepository } from "../../src/domain/inbound-email/inbound-email.repository";
import { createDrizzlePaymentRepository } from "../../src/domain/payment/payment.repository";
import { createStoredFlightSearchFromWakanow } from "../../src/domain/flight/flight.repository";
import { createDrizzleSupplierBookingRepository } from "../../src/workflows/supplier-booking.workflow";
import { describe, expect, test } from "vitest";


describe("unit raw sql nullability", () => {
  test("raw sql nullability", async () => {
    expect.hasAssertions();
    const executedQueries: unknown[] = [];
    const db = {
      async execute(query: unknown) {
        executedQueries.push(query);
        return { rows: [{ id: "row-1", booking_id: "booking-1", was_created: true }], rowCount: 1 };
      },
    } as unknown as DbClient;

    await createStoredFlightSearchFromWakanow({
      db,
      userId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      now: new Date("2026-04-29T14:49:21.596Z"),
      response: {
        provider: "wakanow",
        searchedAt: "2026-04-29T14:49:21.596Z",
        resultCount: 1,
        request: {
          origin: "ENU",
          destination: "Lagos",
          departureDate: "2026-05-05",
          maxResults: 10,
        },
        results: [
          {
            flightId: "flight-1",
            airline: "Test Air",
            departureTime: "08:00",
            arrivalTime: null,
            duration: "1h 10m",
            stops: null,
            priceText: "NGN 120,000",
            deeplink: "https://example.com/flight-1",
            rawText: "Test Air 08:00 NGN 120,000",
          },
        ],
      },
    });

    await createDrizzlePaymentRepository(db).createPaymentAttempt({
      id: "33333333-3333-4333-8333-333333333333",
      bookingId: "44444444-4444-4444-8444-444444444444",
      method: "transfer",
      amount: 120000,
      currency: "NGN",
      createdAt: new Date("2026-04-29T14:49:21.596Z"),
    });

    await createDrizzleInboundEmailRepository(db).saveInboundEmail({
      bookingId: "44444444-4444-4444-8444-444444444444",
      bookingEmailAliasId: "55555555-5555-4555-8555-555555555555",
      resendEmailId: "email-1",
      from: "supplier@example.com",
      to: ["booking@example.com"],
      subject: "Your code",
      receivedAt: new Date("2026-04-29T14:49:21.596Z"),
      classification: "verification_code",
    });

    await createDrizzleSupplierBookingRepository(db).applySupplierDecision({
      bookingId: "44444444-4444-4444-8444-444444444444",
      status: "manual_review_required",
      supplier: "wakanow",
      eventType: "supplier_hold.unclear",
      eventPayload: { kind: "unclear" },
      observedAt: new Date("2026-04-29T14:49:21.596Z"),
    });

    await createDrizzleBookingRepository(db).collectPassengerDetails({
      bookingId: "44444444-4444-4444-8444-444444444444",
      userId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      supplierContactEmail: "booking@example.com",
      collectedAt: new Date("2026-04-29T14:49:21.596Z"),
      passenger: {
        title: "Mr",
        firstName: "Celestine",
        lastName: "Ejiofor",
        dateOfBirth: "1990-04-12",
        nationality: "Nigerian",
        gender: "Male",
        phone: "08012345678",
        email: "celestine@example.com",
      },
    });

    for (const query of executedQueries) {
      expect(hasUndefinedSqlChunk(query)).toBe(false);
    }

    function hasUndefinedSqlChunk(value: unknown): boolean {
      if (value === undefined) return true;
      if (!value || typeof value !== "object") return false;

      const maybeSql = value as SQL & { queryChunks?: unknown[] };
      if (!Array.isArray(maybeSql.queryChunks)) return false;

      return maybeSql.queryChunks.some(hasUndefinedSqlChunk);
    }
  });
});
