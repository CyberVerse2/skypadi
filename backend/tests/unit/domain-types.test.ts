
import { isTerminalBookingStatus } from "../../src/domain/booking/booking.types";
import { makeNeedsUserInput, makeOk } from "../../src/workflows/workflow-result";
import { describe, expect, test } from "vitest";


describe("unit domain types", () => {
  test.each([
    ["issued", true],
    ["hold_expired", true],
    ["payment_pending", false],
  ] as const)("terminal booking status for %s is %s", (status, expected) => {
    expect.hasAssertions();

    expect(isTerminalBookingStatus(status)).toBe(expected);
  });

  test("workflow result helpers preserve their payload shape", () => {
    expect.hasAssertions();
    expect(makeOk({ message: "ready" })).toEqual({
      kind: "ok",
      value: { message: "ready" },
    });

    expect(makeNeedsUserInput("origin", { type: "origin_list" })).toEqual({
      kind: "needs_user_input",
      field: "origin",
      ui: { type: "origin_list" },
    });
  });
});
