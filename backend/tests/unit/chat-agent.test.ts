
import { zodSchema } from "ai";
import { describe, expect, test } from "vitest";

import { buildPrompt, chatActionResponseSchema, decideChatActionWithModel } from "../../src/tools/chat-agent";


describe("unit chat agent", () => {
  test("chat agent", async () => {
    expect.hasAssertions();
    const baseDecisionInput = {
      userText: "Find Lagos to Enugu next Saturday",
      now: new Date("2026-05-01T09:00:00.000Z"),
      context: {
        conversationId: "conversation-1",
        userId: "user-1",
        phoneNumber: "2348012345678",
      },
    };

    const prompt = buildPrompt(baseDecisionInput);
    expect(prompt).toMatch(/Use “best value” instead of “cheapest” in user-facing messages/);

    const searchDecision = await decideChatActionWithModel(
      async () => ({
        type: "tool",
        tool: "searchFlights",
        input: {
          origin: "LOS",
          destination: "ENU",
          departureDate: "2026-05-09",
          adults: 1,
        },
      }),
      baseDecisionInput
    );

    expect(searchDecision.type).toBe("tool");
    if (searchDecision.type === "tool") {
      expect(searchDecision.tool).toBe("searchFlights");
    }
    if (searchDecision.type === "tool" && searchDecision.tool === "searchFlights") {
      expect(searchDecision.input.destination).toBe("ENU");
    }

    const replyDecision = await decideChatActionWithModel(
      async () => ({
        type: "reply",
        message: "Domestic flights usually need a valid ID at check-in.",
      }),
      { ...baseDecisionInput, userText: "Do I need an ID?" }
    );

    expect(replyDecision).toEqual({
      type: "reply",
      message: "Domestic flights usually need a valid ID at check-in.",
    });

    const modelShapeSearchDecision = await decideChatActionWithModel(
      async () => ({
        action: "searchFlights",
        message: null,
        searchFlightsInput: {
          origin: "LOS",
          destination: "ENU",
          departureDate: "2026-05-09",
          departureWindow: "morning",
          returnDate: null,
          adults: 1,
        },
        collectTripDetailsInput: null,
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(modelShapeSearchDecision).toEqual({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "LOS",
        destination: "ENU",
        departureDate: "2026-05-09",
        departureWindow: "morning",
        adults: 1,
      },
    });

    const lagosAliasSearchDecision = await decideChatActionWithModel(
      async () => ({
        action: "searchFlights",
        message: null,
        searchFlightsInput: {
          origin: "ENU",
          destination: "LAG",
          departureDate: "2026-05-08",
          departureWindow: "anytime",
          returnDate: null,
          adults: 1,
        },
        collectTripDetailsInput: null,
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(lagosAliasSearchDecision).toEqual({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "ENU",
        destination: "LOS",
        departureDate: "2026-05-08",
        departureWindow: "anytime",
        adults: 1,
      },
    });

    const abujaAliasSearchDecision = await decideChatActionWithModel(
      async () => ({
        action: "searchFlights",
        message: null,
        searchFlightsInput: {
          origin: "ENU",
          destination: "ABU",
          departureDate: "2026-05-03",
          departureWindow: "morning",
          returnDate: null,
          adults: 2,
        },
        collectTripDetailsInput: null,
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(abujaAliasSearchDecision).toEqual({
      type: "tool",
      tool: "searchFlights",
      input: {
        origin: "ENU",
        destination: "ABV",
        departureDate: "2026-05-03",
        departureWindow: "morning",
        adults: 2,
      },
    });

    const modelShapeCollectTripDetailsDecision = await decideChatActionWithModel(
      async () => ({
        action: "collectTripDetails",
        message: null,
        searchFlightsInput: null,
        collectTripDetailsInput: {
          origin: "LOS",
          destination: null,
          departureDate: "2026-05-09",
          departureWindow: "morning",
          returnDate: null,
          adults: 1,
        },
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(modelShapeCollectTripDetailsDecision).toEqual({
      type: "tool",
      tool: "collectTripDetails",
      input: {
        origin: "LOS",
        departureDate: "2026-05-09",
        departureWindow: "morning",
        adults: 1,
      },
    });

    const modelShapeStartNewTripDecision = await decideChatActionWithModel(
      async () => ({
        action: "startNewTrip",
        message: null,
        searchFlightsInput: null,
        collectTripDetailsInput: {
          origin: null,
          destination: "LAG",
          departureDate: "2026-05-05",
          departureWindow: null,
          returnDate: null,
          adults: null,
        },
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      {
        ...baseDecisionInput,
        context: {
          ...baseDecisionInput.context,
          currentDraft: {
            origin: "ENU",
            destination: "ABU",
            departureDate: "2026-05-06",
            adults: 2,
          },
        },
      }
    );

    expect(modelShapeStartNewTripDecision).toEqual({
      type: "tool",
      tool: "startNewTrip",
      input: {
        destination: "LOS",
        departureDate: "2026-05-05",
      },
    });

    const modelShapeControlledReplyDecision = await decideChatActionWithModel(
      async () => ({
        action: "sendControlledReply",
        message: null,
        searchFlightsInput: null,
        collectTripDetailsInput: null,
        sendControlledReplyInput: { key: "skypadi_intro" },
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(modelShapeControlledReplyDecision).toEqual({
      type: "tool",
      tool: "sendControlledReply",
      input: { key: "skypadi_intro" },
    });

    const customClarificationDecision = await decideChatActionWithModel(
      async () => ({
        action: "sendCustomClarification",
        message: null,
        searchFlightsInput: null,
        collectTripDetailsInput: null,
        sendControlledReplyInput: null,
        customClarificationInput: {
          body: "Do you mean this Tuesday or next Tuesday?",
          widget: {
            type: "reply_buttons",
            buttonText: null,
            options: [
              { id: "date:2026-05-05", title: "Tue, May 5", description: null },
              { id: "date:2026-05-12", title: "Tue, May 12", description: "Next week" },
            ],
          },
        },
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(customClarificationDecision).toEqual({
      type: "tool",
      tool: "sendCustomClarification",
      input: {
        body: "Do you mean this Tuesday or next Tuesday?",
        widget: {
          type: "reply_buttons",
          options: [
            { id: "date:2026-05-05", title: "Tue, May 5" },
            { id: "date:2026-05-12", title: "Tue, May 12", description: "Next week" },
          ],
        },
      },
    });

    const modelShapeSideQuestionDecision = await decideChatActionWithModel(
      async () => ({
        action: "answerSideQuestion",
        message: "Domestic flights usually need a valid ID at check-in.",
        searchFlightsInput: null,
        collectTripDetailsInput: null,
        sendControlledReplyInput: null,
        customClarificationInput: null,
        startBookingJobInput: null,
        passengerDetailsInput: null,
      }),
      baseDecisionInput
    );

    expect(modelShapeSideQuestionDecision).toEqual({
      type: "reply",
      message: "Domestic flights usually need a valid ID at check-in.",
    });

    const longReply = await decideChatActionWithModel(
      async () => ({
        type: "reply",
        message: "A. B. C. D.",
      }),
      { ...baseDecisionInput, userText: "Explain everything" }
    );

    expect(longReply.type).toBe("reply");
    if (longReply.type === "reply") {
      expect(longReply.message).toBe("A. B. C.");
    }

    await expect(decideChatActionWithModel(
        async () => ({
          action: "searchFlights",
          message: null,
          searchFlightsInput: null,
          collectTripDetailsInput: null,
          sendControlledReplyInput: null,
          customClarificationInput: null,
          startBookingJobInput: null,
        passengerDetailsInput: null,
        }),
        baseDecisionInput
      )).rejects.toThrow(/searchFlights action requires searchFlightsInput/);

    await expect(decideChatActionWithModel(
        async () => ({
          type: "tool",
          tool: "searchFlights",
          input: {
            origin: "LOS",
            destination: "ENU",
            departureDate: "2026-05-09",
          },
        }),
        baseDecisionInput
      )).rejects.toThrow();

    await expect(decideChatActionWithModel(
        async () => ({
          type: "tool",
          tool: "searchFlights",
          input: {
            origin: "LO",
            destination: "ENU",
            departureDate: "2026-05-09",
            adults: 1,
          },
        }),
        baseDecisionInput
      )).rejects.toThrow();

    await expect(decideChatActionWithModel(
        async () => ({
          type: "tool",
          tool: "searchFlights",
          input: {
            origin: "LOS",
            destination: "ENU",
            departureDate: "2026-05-09",
            returnDate: "2026-05-08",
            adults: 1,
          },
        }),
        baseDecisionInput
      )).rejects.toThrow();
  });

  test("chat model response schema is valid for strict OpenAI structured outputs", async () => {
    expect.hasAssertions();
    const schema = await zodSchema(chatActionResponseSchema).jsonSchema;
    const optionSchema = findObjectSchemaWithProperties(schema, ["id", "title", "description"]);

    expect(optionSchema).toBeTruthy();
    if (!optionSchema) {
      throw new Error("Expected custom clarification option schema to be present");
    }
    expect(new Set(optionSchema.required)).toEqual(new Set(["id", "title", "description"]));
  });

  function findObjectSchemaWithProperties(value: unknown, properties: string[]): { required?: string[] } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const schemaProperties = record.properties;
    if (schemaProperties && typeof schemaProperties === "object") {
      const propertyKeys = new Set(Object.keys(schemaProperties));
      if (properties.every((property) => propertyKeys.has(property))) {
        return record as { required?: string[] };
      }
    }

    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const result = findObjectSchemaWithProperties(item, properties);
          if (result) return result;
        }
        continue;
      }
      const result = findObjectSchemaWithProperties(child, properties);
      if (result) return result;
    }
    return undefined;
  }
});
