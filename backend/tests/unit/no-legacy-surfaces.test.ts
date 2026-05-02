import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";


describe("unit no legacy surfaces", () => {
  const source = () => {
    const root = new URL("../../src", import.meta.url).pathname;

    function files(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    }

    return files(root)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .toLowerCase();
  };

  test.each([
    ["tele", "gram"].join(""),
    ["gr", "ammy"].join(""),
    ["agent", "mail"].join(""),
    "patchright",
    "stealth",
  ])("does not reference legacy surface %s", (term) => {
    expect.hasAssertions();

    expect(source()).not.toContain(term);
  });
});
