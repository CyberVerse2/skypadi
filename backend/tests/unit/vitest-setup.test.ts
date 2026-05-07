import { describe, expect, test, vi } from "vitest";

describe("vitest setup", () => {
  test("can leave fake timers and spies behind", () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(123);

    expect(Date.now()).toBe(123);
  });

  test("restores timers and spies between tests", () => {
    expect.hasAssertions();
    expect(vi.isFakeTimers()).toBe(false);
    expect(Date.now()).not.toBe(123);
  });
});
