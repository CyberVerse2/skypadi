
import { createOpenAIIntentExtractor } from "../../src/agent/intent-extractor";
import { describe, expect, test } from "vitest";


describe("unit ai intent extractor", () => {
  test("ai intent extractor", async () => {
    let capturedPrompt = "";
    const extractor = createOpenAIIntentExtractor({
      apiKey: "test-key",
      model: "gpt-test",
      generateObject: async (input) => {
        capturedPrompt = input.prompt;
        return {
          object: {
            kind: "flight_search",
            reply: null,
            origin: null,
            destination: "Abuja",
            departureDate: "2026-04-30",
            departureWindow: "morning",
            returnDate: null,
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

    expect(result).toEqual({
      kind: "flight_search",
      destination: "Abuja",
      departureDate: "2026-04-30",
      departureWindow: "morning",
      adults: 2,
    });
    expect(capturedPrompt).toMatch(/Please get us two morning seats to Abuja tomorrow/);
    expect(capturedPrompt).toMatch(/2026-04-29/);

    const emptyExtractor = createOpenAIIntentExtractor({
      apiKey: "test-key",
      model: "gpt-test",
      generateObject: async () => ({
        object: {
          kind: "general_chat",
          reply: "Hi, I’m Skypadi. Tell me where you want to travel when you’re ready.",
          origin: null,
          destination: null,
          departureDate: null,
          departureWindow: null,
          returnDate: null,
          adults: null,
        },
      }),
    });

    const emptyResult = await emptyExtractor.extractTripIntent({
      text: "Hi",
      now: new Date("2026-04-29T08:00:00.000Z"),
      expectedField: undefined,
      currentDraft: {},
    });

    expect(emptyResult).toEqual({
      kind: "general_chat",
      reply: "Hi, I’m Skypadi. Tell me where you want to travel when you’re ready.",
    });

    console.log("AI intent extractor tests passed");
  });
});
