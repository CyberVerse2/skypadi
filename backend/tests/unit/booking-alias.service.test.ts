import { describe, expect, test } from "vitest";

import { generateBookingEmailAlias } from "../../src/integrations/resend/booking-alias.service";

describe("booking alias service", () => {
  test("generates human-readable booking aliases", () => {
    expect.hasAssertions();

    expect(generateBookingEmailAlias({
      domain: "bookings.skypadi.com",
      idGenerator: () => "abc123",
    })).toEqual({
      emailAddress: "tolu.nwachukwu.abc123@bookings.skypadi.com",
      localPart: "tolu.nwachukwu.abc123",
      domain: "bookings.skypadi.com",
    });
  });
});
