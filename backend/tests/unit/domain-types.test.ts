
import { isTerminalBookingStatus } from "../../src/domain/booking/booking.types";
import { makeNeedsUserInput, makeOk } from "../../src/workflows/workflow-result";
import { describe, expect, test } from "vitest";


describe("unit domain types", () => {
  test("domain types", async () => {
    expect(isTerminalBookingStatus("issued")).toBe(true);
    expect(isTerminalBookingStatus("hold_expired")).toBe(true);
    expect(isTerminalBookingStatus("payment_pending")).toBe(false);

    expect(makeOk({ message: "ready" })).toEqual({
      kind: "ok",
      value: { message: "ready" },
    });

    expect(makeNeedsUserInput("origin", { type: "origin_list" })).toEqual({
      kind: "needs_user_input",
      field: "origin",
      ui: { type: "origin_list" },
    });

    console.log("domain type tests passed");
  });
});
