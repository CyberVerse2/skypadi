
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
  test("schema", async () => {
    const tables = [
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
    ];

    expect(tables.length).toBe(14);
    expect(bookings.status.enumValues.includes("awaiting_payment_for_hold")).toBe(true);
    expect(bookings.supplierBookingState.name).toBe("supplier_booking_state");
    expect(bookings.supplierPaymentInstructions.name).toBe("supplier_payment_instructions");
    expect(paymentAttempts.status.enumValues.includes("proof_uploaded")).toBe(true);
    expect(inboundEmails.classification.enumValues.includes("verification_code")).toBe(true);
    console.log("schema tests passed");
  });
});
