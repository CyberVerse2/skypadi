import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";


describe("unit no legacy surfaces", () => {
  test("no legacy surfaces", async () => {
    const root = new URL("../../src", import.meta.url).pathname;

    function files(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    }

    const source = files(root)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .toLowerCase();

    const banned = [
      ["tele", "gram"].join(""),
      ["gr", "ammy"].join(""),
      ["agent", "mail"].join(""),
      "patchright",
      "stealth",
    ];

    for (const term of banned) {
      expect(source.includes(term)).toBe(false);
    }
    console.log("legacy surface tests passed");
  });
});
