import assert from "node:assert/strict";

import { shouldSkipSupplierBookingForStatus } from "../../src/jobs/tasks/supplier-booking-status";

assert.equal(shouldSkipSupplierBookingForStatus("supplier_booking_pending"), false);
assert.equal(shouldSkipSupplierBookingForStatus("manual_review_required"), true);
assert.equal(shouldSkipSupplierBookingForStatus("awaiting_payment_for_hold"), true);
assert.equal(shouldSkipSupplierBookingForStatus("payment_pending"), true);
assert.equal(shouldSkipSupplierBookingForStatus("supplier_verification_required"), true);
assert.equal(shouldSkipSupplierBookingForStatus("issued"), true);
assert.equal(shouldSkipSupplierBookingForStatus(undefined), false);

console.log("supplier booking task workflow tests passed");
