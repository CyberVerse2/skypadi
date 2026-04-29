import assert from "node:assert/strict";

import { assertOk } from "../test-helpers/assert.js";

assertOk({ ok: true, value: "ready" });
assert.throws(() => assertOk({ ok: false, error: "nope" }), /Expected ok result/);
console.log("test harness tests passed");
