
import {
  auditEvents,
  bookingEmailAliases,
  bookings,
  conversationMessages,
  conversations,
  flightOptions,
  flightSearches,
  inboundEmails,
  passengers,
  paymentAttempts,
  supplierAccountAssignments,
  supplierEvents,
  users,
  whatsappContacts,
} from "../../src/db/schema";
import { describe, expect, test } from "vitest";


describe("unit schema", () => {
  test("exports every table needed by the app data model", () => {
    expect.hasAssertions();

    const tablesByName = {
      users,
      whatsappContacts,
      conversations,
      conversationMessages,
      passengers,
      flightSearches,
      flightOptions,
      bookings,
      paymentAttempts,
      supplierAccountAssignments,
      bookingEmailAliases,
      inboundEmails,
      supplierEvents,
      auditEvents,
    };

    expect(Object.keys(tablesByName)).toEqual([
      "users",
      "whatsappContacts",
      "conversations",
      "conversationMessages",
      "passengers",
      "flightSearches",
      "flightOptions",
      "bookings",
      "paymentAttempts",
      "supplierAccountAssignments",
      "bookingEmailAliases",
      "inboundEmails",
      "supplierEvents",
      "auditEvents",
    ]);
    expect(Object.values(tablesByName)).toHaveLength(14);
  });

  test("keeps booking, payment, and inbound-email enums aligned with workflows", () => {
    expect.hasAssertions();
    expect(bookings.status.enumValues.includes("awaiting_payment_for_hold")).toBe(true);
    expect(bookings.supplierBookingState.name).toBe("supplier_booking_state");
    expect(bookings.supplierPaymentInstructions.name).toBe("supplier_payment_instructions");
    expect(paymentAttempts.status.enumValues.includes("proof_uploaded")).toBe(true);
    expect(inboundEmails.classification.enumValues.includes("verification_code")).toBe(true);
  });
});
