import assert from "node:assert/strict";

import { assertOk } from "../test-helpers/assert";
import { test } from "vitest";

test("test harness", async () => {
  assertOk({ ok: true, value: "ready" });
  assert.throws(() => assertOk({ ok: false, error: "nope" }), /Expected ok result/);
  console.log("test harness tests passed");
});
