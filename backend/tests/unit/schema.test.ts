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
  supplierEvents,
  users,
  whatsappContacts,
} from "../../src/db/schema.js";

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
  bookingEmailAliases,
  inboundEmails,
  supplierEvents,
  auditEvents,
];

assert.equal(tables.length, 13);
assert.equal(bookings.status.enumValues.includes("awaiting_payment_for_hold"), true);
assert.equal(paymentAttempts.status.enumValues.includes("proof_uploaded"), true);
assert.equal(inboundEmails.classification.enumValues.includes("verification_code"), true);
console.log("schema tests passed");
