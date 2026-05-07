
import { assertOk } from "../test-helpers/assert";
import { describe, expect, test } from "vitest";


describe("unit test harness", () => {
  test("assertOk returns the value from ok results", () => {
    expect.hasAssertions();

    expect(assertOk({ ok: true, value: "ready" })).toBe("ready");
  });

  test("assertOk throws the error from failed results", () => {
    expect.hasAssertions();

    expect(() => assertOk({ ok: false, error: "nope" })).toThrow(/Expected ok result/);
  });
});
