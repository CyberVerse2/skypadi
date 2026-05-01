import assert from "node:assert/strict";

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
import { test } from "vitest";

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

  assert.equal(tables.length, 14);
  assert.equal(bookings.status.enumValues.includes("awaiting_payment_for_hold"), true);
  assert.equal(bookings.supplierBookingState.name, "supplier_booking_state");
  assert.equal(bookings.supplierPaymentInstructions.name, "supplier_payment_instructions");
  assert.equal(paymentAttempts.status.enumValues.includes("proof_uploaded"), true);
  assert.equal(inboundEmails.classification.enumValues.includes("verification_code"), true);
  console.log("schema tests passed");
});
