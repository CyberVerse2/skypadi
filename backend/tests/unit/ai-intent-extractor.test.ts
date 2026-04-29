import assert from "node:assert/strict";

import { createOpenAIIntentExtractor } from "../../src/agent/intent-extractor.js";

let capturedPrompt = "";
const extractor = createOpenAIIntentExtractor({
  apiKey: "test-key",
  model: "gpt-test",
  generateObject: async (input) => {
    capturedPrompt = input.prompt;
    return {
      object: {
        destination: "Abuja",
        departureDate: "2026-04-30",
        departureWindow: "morning",
        adults: 2,
      },
    };
  },
});

const result = await extractor.extractTripIntent({
  text: "Please get us two morning seats to Abuja tomorrow",
  now: new Date("2026-04-29T08:00:00.000Z"),
  expectedField: undefined,
  currentDraft: {},
});

assert.deepEqual(result, {
  destination: "Abuja",
  departureDate: "2026-04-30",
  departureWindow: "morning",
  adults: 2,
});
assert.match(capturedPrompt, /Please get us two morning seats to Abuja tomorrow/);
assert.match(capturedPrompt, /2026-04-29/);

console.log("AI intent extractor tests passed");
