
import { assertOk } from "../test-helpers/assert";
import { describe, expect, test } from "vitest";


describe("unit test harness", () => {
  test("test harness", async () => {
    assertOk({ ok: true, value: "ready" });
    expect(() => assertOk({ ok: false, error: "nope" })).toThrow(/Expected ok result/);
    console.log("test harness tests passed");
  });
});
